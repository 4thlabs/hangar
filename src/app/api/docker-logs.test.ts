import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build. `docker-route.ts` next door is what the
// 401/404/503 assertions below actually exercise.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  openLogs: vi.fn(),
  runtime: { run: vi.fn() },
  logger: { error: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/docker/server.ts", () => ({ docker: { openLogs: mocks.openLogs } }));
vi.mock("#libs/hangar/server", () => ({ hangar: { runtime: mocks.runtime } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { DockerNotFoundError } = await import("#libs/docker/compose.ts");
const { GET } = await import("#app/pages/_api/api/docker/apps/[project]/containers/[container]/logs.ts");
const context = { params: { project: "alpha", container: "a".repeat(64) } };

describe("GET Docker container logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "1" } });
    mocks.openLogs.mockResolvedValue(Readable.from([Buffer.from("hello\n")]));
  });

  it("returns 401 before opening Docker logs", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/logs"), context);

    expect(response.status).toBe(401);
    expect(mocks.openLogs).not.toHaveBeenCalled();
  });

  it("streams logs with buffering disabled, handing the request signal to the child", async () => {
    const request = new Request("http://localhost/logs");

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe("hello\n");
    // The signal is what tears the log stream down when the client disconnects.
    expect(mocks.openLogs).toHaveBeenCalledWith("alpha", "a".repeat(64), request.signal);
  });

  it("returns 404 when the container is absent or belongs to another project", async () => {
    mocks.openLogs.mockRejectedValue(new DockerNotFoundError("test subject"));

    await expect(GET(new Request("http://localhost/logs"), context)).resolves.toMatchObject({ status: 404 });
  });

  it("returns 503 without leaking transport errors", async () => {
    mocks.openLogs.mockRejectedValue(new Error("private socket detail"));

    const response = await GET(new Request("http://localhost/logs"), context);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).not.toContain("private socket detail");
  });
});
