import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Docker } from "#libs/docker";
import type { Hangar } from "#libs/hangar";
import type { Notifications } from "#libs/notifications";
import type { JobServices } from "../services.ts";
import { UpdateOutdatedApps } from "./update-outdated-apps.ts";

vi.mock("#libs/logs", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const compose = vi.fn();
const checkUpdates = vi.fn();
const notify = vi.fn();

/**
 * The doubles the job runs against, handed over through its constructor. Cast once here: each
 * stands in for a class whose other members the job never touches.
 */
const services = {
  hangar: { store: { config: { registryThrottling: () => 0 }, compose } } as unknown as Hangar,
  docker: { checkUpdates } as unknown as Docker,
  notifications: { notify } as unknown as Notifications,
} satisfies JobServices;

const job = new UpdateOutdatedApps(async () => services);

describe("UpdateOutdatedApps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compose.mockResolvedValue(undefined);
  });

  it("pulls and recreates every outdated app, and reports the one that failed", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set(["immich", "nginx"]) });
    compose.mockImplementation(async (project: string) => {
      if (project === "nginx") {
        throw new Error("pull failed");
      }
    });

    const report = await job.run();

    expect(compose).toHaveBeenCalledWith("immich", ["up", "-d", "--pull", "always"]);
    expect(report).toMatchObject({ updated: ["immich"], failed: ["nginx"] });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ level: "error", dedupeKey: "auto-update" }));
  });

  it("touches nothing and notifies no one when every app is up to date", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set() });

    const report = await job.run();

    expect(compose).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(report).toMatchObject({ updated: [], failed: [] });
  });
});
