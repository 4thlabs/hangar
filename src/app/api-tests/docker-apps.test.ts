import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listComposeProjects: vi.fn(),
  installedProjectIds: vi.fn(() => new Set(["alpha"])),
  runtime: { run: vi.fn() },
  logger: { error: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/docker", async importOriginal => ({
  // The response helpers and error class are real; only the Docker calls are stubbed.
  ...(await importOriginal<typeof import("#libs/docker")>()),
  listComposeProjects: mocks.listComposeProjects,
}));
vi.mock("#libs/hangar/server", () => ({
  hangar: { runtime: mocks.runtime, store: { installedProjectIds: mocks.installedProjectIds } },
}));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { GET } = await import("#app/pages/_api/api/docker/apps.ts");

describe("GET /api/docker/apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "1" } });
    mocks.listComposeProjects.mockResolvedValue({ sampledAt: "2026-01-01T00:00:00.000Z", projects: [] });
  });

  it("returns 401 without querying Docker when signed out", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/docker/apps"));

    expect(response.status).toBe(401);
    expect(mocks.listComposeProjects).not.toHaveBeenCalled();
  });

  it("returns the Docker snapshot and disables caching", async () => {
    const response = await GET(new Request("http://localhost/api/docker/apps"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ success: true, data: { projects: [] } });
    expect(mocks.listComposeProjects).toHaveBeenCalledWith(mocks.runtime, new Set(["alpha"]));
  });

  it("maps Docker failures to 503 without leaking details", async () => {
    mocks.listComposeProjects.mockRejectedValue(new Error("socket secret"));

    const response = await GET(new Request("http://localhost/api/docker/apps"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).not.toContain("socket secret");
  });
});
