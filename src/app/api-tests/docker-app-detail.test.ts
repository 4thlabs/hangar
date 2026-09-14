import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getComposeProjectDetail: vi.fn(),
  installedProjectIds: vi.fn(() => new Set(["alpha"])),
  runtime: { run: vi.fn() },
  logger: { error: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/docker", async importOriginal => ({
  // The response helpers and error class are real; only the Docker calls are stubbed.
  ...(await importOriginal<typeof import("#libs/docker")>()),
  getComposeProjectDetail: mocks.getComposeProjectDetail,
}));
vi.mock("#libs/hangar/server", () => ({
  hangar: { runtime: mocks.runtime, store: { installedProjectIds: mocks.installedProjectIds } },
}));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { DockerNotFoundError } = await import("#libs/docker");
const { GET } = await import("#app/pages/_api/api/docker/apps/[project].ts");
const context = { params: { project: "alpha" } };

describe("GET /api/docker/apps/[project]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "1" } });
    mocks.getComposeProjectDetail.mockResolvedValue({ name: "alpha", services: [] });
  });

  it("returns 401 before querying Docker", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/docker/apps/alpha"), context);

    expect(response.status).toBe(401);
    expect(mocks.getComposeProjectDetail).not.toHaveBeenCalled();
  });

  it("returns project details", async () => {
    const response = await GET(new Request("http://localhost/api/docker/apps/alpha"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { name: "alpha" } });
  });

  it("returns 404 for a project that disappeared", async () => {
    mocks.getComposeProjectDetail.mockRejectedValue(new DockerNotFoundError("test subject"));

    const response = await GET(new Request("http://localhost/api/docker/apps/alpha"), context);

    expect(response.status).toBe(404);
  });

  it("returns 503 for other Docker errors", async () => {
    mocks.getComposeProjectDetail.mockRejectedValue(new Error("socket"));

    const response = await GET(new Request("http://localhost/api/docker/apps/alpha"), context);

    expect(response.status).toBe(503);
  });
});
