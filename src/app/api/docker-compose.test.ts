import { beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build. This covers what the deleted `manageApp`
// action used to, plus the batch loop that replaced it.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  compose: vi.fn(),
  apps: new Set<{ id: string; installed: boolean }>(),
  notify: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/hangar/server", () => ({
  hangar: {
    store: {
      compose: mocks.compose,
      app: (id: string) => [...mocks.apps].find(app => app.id === id),
    },
  },
}));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
vi.mock("#libs/notifications/server", () => ({ notifications: { notify: mocks.notify } }));

const { POST } = await import("#app/pages/_api/api/docker/apps/compose.ts");

const call = (query: string) => POST(new Request(`http://localhost/api/docker/apps/compose?${query}`));

describe("POST Docker Compose stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apps.clear();
    mocks.apps.add({ id: "alpha", installed: true });
    mocks.apps.add({ id: "beta", installed: true });
    mocks.getSession.mockResolvedValue({ user: { id: "1" } });
    mocks.compose.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue(undefined);
  });

  it("returns 401 before running anything", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(call("operation=up&projects=alpha")).resolves.toMatchObject({ status: 401 });
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown operation", "operation=restart&projects=alpha"],
    ["an empty selection", "operation=up&projects="],
    ["a project name that is not one", "operation=up&projects=../alpha"],
  ])("rejects %s before invoking Compose", async (_case, query) => {
    const response = await call(query);

    expect(response.status).toBe(400);
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it("refuses the whole batch when one app is not managed by Hangar", async () => {
    const response = await call("operation=up&projects=alpha,external");

    expect(response.status).toBe(404);
    // Not even the valid one: a batch refused half-way is worse than one refused whole.
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it.each([
    ["up", ["up", "-d"]],
    ["down", ["down"]],
    ["recreate", ["up", "-d", "--force-recreate"]],
  ])("maps %s to the expected Compose command", async (operation, args) => {
    const response = await call(`operation=${operation}&projects=alpha`);
    await response.text();

    expect(mocks.compose).toHaveBeenCalledWith("alpha", args, expect.objectContaining({ pipe: expect.anything() }));
  });

  it("runs the selection in order and notifies once per app", async () => {
    const response = await call("operation=up&projects=alpha,beta");
    const body = await response.text();

    expect(mocks.compose.mock.calls.map(call => call[0])).toEqual(["alpha", "beta"]);
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "1", level: "success", href: "/apps/alpha" }),
    );
    // No failure, so the marker the client reads as an exit code is zero.
    expect(body).toContain("[hangar] exit=0");
  });

  it("carries on after a failed app and counts it in the exit marker", async () => {
    mocks.compose.mockRejectedValueOnce(new Error("secret daemon detail"));

    const response = await call("operation=up&projects=alpha,beta");
    const body = await response.text();

    expect(mocks.compose).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ level: "error", href: "/apps/alpha" }));
    expect(body).toContain("[hangar] exit=1");
    expect(body).not.toContain("secret daemon detail");
  });
});
