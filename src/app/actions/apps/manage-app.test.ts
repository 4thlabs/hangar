import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppOperation } from "./app-operation.ts";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  compose: vi.fn(),
  apps: new Set<{ id: string; installed: boolean }>(),
  logger: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock("#libs/auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("#libs/hangar/server", () => ({ hangar: { store: { apps: mocks.apps, compose: mocks.compose } } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { manageApp } = await import("./manage-app.ts");

describe("manageApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apps.clear();
    mocks.apps.add({ id: "alpha", installed: true });
    mocks.requireSession.mockResolvedValue({ user: { id: "1" } });
    mocks.compose.mockResolvedValue(undefined);
  });

  it.each([
    ["up", ["up", "-d"]],
    ["down", ["down"]],
    ["recreate", ["up", "-d", "--force-recreate"]],
  ] satisfies Array<[AppOperation, string[]]>)("maps %s to the expected Compose command", async (operation, args) => {
    await expect(manageApp("alpha", operation)).resolves.toMatchObject({ success: true });
    expect(mocks.compose).toHaveBeenCalledWith("alpha", args);
  });

  it("requires a session before validating or running the command", async () => {
    mocks.requireSession.mockRejectedValue(new Error("redirect"));

    await expect(manageApp("alpha", "up")).rejects.toThrow("redirect");
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it("rejects invalid input before invoking Compose", async () => {
    await expect(manageApp("../alpha", "invalid" as AppOperation)).resolves.toMatchObject({ success: false });
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it("rejects an application not installed by Hangar", async () => {
    await expect(manageApp("external", "up")).resolves.toMatchObject({ success: false });
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it("turns a Compose failure into a safe action result", async () => {
    mocks.compose.mockRejectedValue(new Error("secret daemon detail"));

    const result = await manageApp("alpha", "up");

    expect(result).toEqual({
      success: false,
      message: "La commande Docker Compose a échoué. Consultez les logs du serveur.",
    });
    expect(result.message).not.toContain("secret daemon detail");
  });
});
