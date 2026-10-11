import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Docker } from "#libs/docker";
import type { Hangar } from "#libs/hangar";
import type { Notifications } from "#libs/notifications";
import type { JobServices } from "../services.ts";
import { UpdateOutdatedApps } from "./update-outdated-apps.ts";

vi.mock("#libs/logs", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const compose = vi.fn();
const checkUpdates = vi.fn();
const projects = vi.fn();
const entry = vi.fn();
const notify = vi.fn();

/** What `docker.projects()` answers: each project with its running container count. */
const snapshot = (running: Record<string, number>) => ({
  projects: Object.entries(running).map(([name, runningCount]) => ({ name, runningCount })),
});

/**
 * The doubles the job runs against, handed over through its constructor. Cast once here: each
 * stands in for a class whose other members the job never touches.
 */
const services = {
  hangar: { store: { config: { registryThrottling: () => 0, entry }, composeApp: compose } } as unknown as Hangar,
  docker: { checkUpdates, projects } as unknown as Docker,
  notifications: { notify } as unknown as Notifications,
} satisfies JobServices;

const job = new UpdateOutdatedApps(async () => services);

describe("UpdateOutdatedApps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compose.mockResolvedValue(undefined);
    entry.mockReturnValue(undefined);
    projects.mockResolvedValue(snapshot({ immich: 1, nginx: 2 }));
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

  it("leaves a stopped app stopped: updating it would start it", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set(["immich", "nginx"]) });
    projects.mockResolvedValue(snapshot({ immich: 0, nginx: 1 }));

    const report = await job.run();

    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose).toHaveBeenCalledWith("nginx", ["up", "-d", "--pull", "always"]);
    expect(report).toMatchObject({ updated: ["nginx"], failed: [] });
  });

  it("skips an app hangar.yml keeps to manual updates, and updates an undeclared one", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set(["immich", "nginx"]) });
    entry.mockImplementation((id: string) => (id === "immich" ? { id, update: false } : undefined));

    const report = await job.run();

    expect(entry).toHaveBeenCalledWith("immich");
    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose).toHaveBeenCalledWith("nginx", ["up", "-d", "--pull", "always"]);
    expect(report).toMatchObject({ updated: ["nginx"], failed: [] });
  });

  it("notifies no one when every outdated app is skipped", async () => {
    checkUpdates.mockResolvedValue({ remotes: {}, outdated: new Set(["immich"]) });
    entry.mockReturnValue({ id: "immich", update: false });

    await job.run();

    expect(compose).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
