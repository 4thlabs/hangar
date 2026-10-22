import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the routes: waku turns every file under `src/app/pages/` into a route,
// test files included, which breaks the build.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  terminals: { open: vi.fn(), write: vi.fn(), resize: vi.fn() },
  logger: { error: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { get: mocks.getSession } }));
vi.mock("#libs/docker/server", () => ({ terminals: mocks.terminals }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { DockerNotFoundError } = await import("#libs/docker");
const { POST: open } = await import("#app/pages/_api/api/docker/apps/[project]/containers/[container]/terminal.ts");
const { POST: send } = await import("#app/pages/_api/api/docker/terminals/[terminal].ts");

const CONTAINER_ID = "a".repeat(64);

/** A JSON `POST`, as the terminal sends them. */
const post = (body: unknown) =>
  new Request("http://localhost/terminal", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
});

describe("POST a container terminal", () => {
  const context = { params: { project: "alpha", container: CONTAINER_ID } };

  beforeEach(() => {
    mocks.terminals.open.mockResolvedValue({ id: "session-1", output: Readable.from([Buffer.from("/ # ")]) });
  });

  it("returns 401 before opening a shell", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await open(post({ cols: 80, rows: 24 }), context);

    expect(response.status).toBe(401);
    expect(mocks.terminals.open).not.toHaveBeenCalled();
  });

  it("streams the shell with its session id, handing the request signal down", async () => {
    const request = post({ cols: 80, rows: 24 });

    const response = await open(request, context);

    expect(response.headers.get("x-terminal-id")).toBe("session-1");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(await response.text()).toBe("/ # ");
    // The signal is what closes the session when the client disconnects.
    expect(mocks.terminals.open).toHaveBeenCalledWith(
      { owner: "user-1", project: "alpha", containerId: CONTAINER_ID },
      { cols: 80, rows: 24 },
      request.signal,
    );
  });

  it("returns 400 for a size out of bounds", async () => {
    await expect(open(post({ cols: 0, rows: 24 }), context)).resolves.toMatchObject({ status: 400 });
    expect(mocks.terminals.open).not.toHaveBeenCalled();
  });

  it("returns 404 when the container is absent or belongs to another project", async () => {
    mocks.terminals.open.mockRejectedValue(new DockerNotFoundError("test subject"));

    await expect(open(post({ cols: 80, rows: 24 }), context)).resolves.toMatchObject({ status: 404 });
  });
});

describe("POST to a terminal session", () => {
  const context = { params: { terminal: "session-1" } };

  it("returns 401 before reaching the session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(send(post({ input: "ls\r" }), context)).resolves.toMatchObject({ status: 401 });
    expect(mocks.terminals.write).not.toHaveBeenCalled();
  });

  it("types the input as the signed-in user", async () => {
    const response = await send(post({ input: "ls\r" }), context);

    expect(response.status).toBe(204);
    expect(mocks.terminals.write).toHaveBeenCalledWith("session-1", "user-1", "ls\r");
  });

  it("resizes the session", async () => {
    await send(post({ cols: 120, rows: 40 }), context);

    expect(mocks.terminals.resize).toHaveBeenCalledWith("session-1", "user-1", { cols: 120, rows: 40 });
  });

  it("returns 400 for a message that is neither input nor size", async () => {
    await expect(send(post({ input: "" }), context)).resolves.toMatchObject({ status: 400 });
    await expect(send(post({ command: "ls" }), context)).resolves.toMatchObject({ status: 400 });
  });

  it("returns 404 once the session is gone", async () => {
    mocks.terminals.write.mockImplementation(() => {
      throw new DockerNotFoundError("terminal session-1");
    });

    await expect(send(post({ input: "ls\r" }), context)).resolves.toMatchObject({ status: 404 });
  });
});
