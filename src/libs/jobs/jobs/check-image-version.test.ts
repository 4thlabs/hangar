import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Docker } from "#libs/docker";
import type { Hangar } from "#libs/hangar";
import type { Notifications } from "#libs/notifications";
import type { JobServices } from "../services.ts";
import { CheckImageVersion } from "./check-image-version.ts";

vi.mock("#libs/logs", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const checkUpdates = vi.fn();
const notify = vi.fn();

/**
 * The doubles the job runs against, handed over through its constructor. Cast once here: each
 * stands in for a class whose other members the job never touches.
 */
const services = {
  hangar: { store: { config: { registryThrottling: () => 250 } } } as unknown as Hangar,
  docker: { checkUpdates } as unknown as Docker,
  notifications: { notify } as unknown as Notifications,
} satisfies JobServices;

const job = new CheckImageVersion(async () => services);

describe("CheckImageVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the registry at the store's pace and returns its answers as the report", async () => {
    const remotes = { "nginx:alpine": "sha256:new" };

    checkUpdates.mockResolvedValue({ remotes, outdated: new Set() });

    const report = await job.run();

    expect(checkUpdates).toHaveBeenCalledWith(250);
    expect(report.remotes).toEqual(remotes);
  });

  it("notifies once with the number of outdated apps", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set(["immich", "nginx"]) });

    await job.run();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ description: "2 applications ont une image plus récente en registre." }),
    );
  });

  it("notifies no one when every app is up to date", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set() });

    await job.run();

    expect(notify).not.toHaveBeenCalled();
  });
});
