import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBackups } from "#libs/backups";
import type { Docker } from "#libs/docker";
import type { BackupConfig, Hangar } from "#libs/hangar";
import type { Notifications } from "#libs/notifications";
import type { JobServices } from "../services.ts";
import { BackupApp } from "./backup-app.ts";

vi.mock("#libs/logs", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// The short id Docker gives Hangar's own container as its hostname.
vi.mock("node:os", async importOriginal => ({ ...(await importOriginal<object>()), hostname: () => "4a1b2c3d4e5f" }));

const backup = vi.fn<(app: string) => BackupConfig | undefined>();
const compose = vi.fn();
const projectDetail = vi.fn();
const create = vi.fn();
const notify = vi.fn();

/**
 * The doubles the job runs against, handed over through its constructor. Cast once here: each
 * stands in for a class whose other members the job never touches.
 */
const services = {
  hangar: { store: { config: { backup }, compose } } as unknown as Hangar,
  docker: { projectDetail } as unknown as Docker,
  backups: { create } as unknown as AppBackups,
  notifications: { notify } as unknown as Notifications,
} satisfies JobServices;

const job = new BackupApp(async () => services);

const summary = { archive: "2026-10-18T03-30-00-000Z", size: 2048, files: 3, skippedLinks: 0 };

/** A backup as hangar.yml declares it once defaulted. */
function backupOf(app: string, overrides: Partial<BackupConfig> = {}): BackupConfig {
  return { app, keep: 7, stop: false, include: ["**"], exclude: [], ...overrides };
}

/** A service of the project detail, with one container per state. */
function service(name: string, states: string[], idPrefix = "0f0f0f0f0f0f") {
  return {
    name,
    runningCount: states.filter(state => state === "running").length,
    containers: states.map((state, index) => ({ id: `${idPrefix}${index}`, state })),
  };
}

describe("BackupApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compose.mockResolvedValue(undefined);
    create.mockResolvedValue(summary);
  });

  it("archives the app without touching its containers when it need not stop", async () => {
    backup.mockReturnValue(backupOf("jellyfin"));

    const report = await job.run("jellyfin");

    expect(create).toHaveBeenCalledWith(backupOf("jellyfin"), expect.any(AbortSignal));
    expect(projectDetail).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(report).toMatchObject({ app: "jellyfin", ...summary, stopped: [] });
  });

  it("stops only the running services, and starts the same ones again", async () => {
    backup.mockReturnValue(backupOf("immich", { stop: true }));
    projectDetail.mockResolvedValue({
      services: [service("server", ["running"]), service("ml", ["exited"]), service("db", ["running"])],
    });

    const report = await job.run("immich");

    expect(compose.mock.calls).toEqual([
      ["immich", ["stop", "server", "db"]],
      ["immich", ["start", "server", "db"]],
    ]);

    expect(report.stopped).toEqual(["server", "db"]);
  });

  it("starts the stopped services again when the archive fails, and notifies the failure", async () => {
    backup.mockReturnValue(backupOf("immich", { stop: true }));
    projectDetail.mockResolvedValue({ services: [service("server", ["running"])] });
    create.mockRejectedValue(new Error("disk full"));

    await expect(job.run("immich")).rejects.toThrow("disk full");

    expect(compose).toHaveBeenLastCalledWith("immich", ["start", "server"]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", dedupeKey: "backup:immich", href: "/apps/immich" }),
    );
  });

  it("notifies an app left stopped when it does not start again", async () => {
    backup.mockReturnValue(backupOf("immich", { stop: true }));
    projectDetail.mockResolvedValue({ services: [service("server", ["running"])] });
    compose.mockImplementation(async (_app: string, args: string[]) => {
      if (args[0] === "start") {
        throw new Error("port taken");
      }
    });

    await expect(job.run("immich")).rejects.toThrow("port taken");

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "backup-restart:immich" }));
  });

  it("stops nothing when nothing runs", async () => {
    backup.mockReturnValue(backupOf("immich", { stop: true }));
    projectDetail.mockResolvedValue({ services: [service("server", ["exited"])] });

    await job.run("immich");

    expect(compose).not.toHaveBeenCalled();
  });

  it("refuses to stop the app Hangar itself runs in", async () => {
    backup.mockReturnValue(backupOf("hangar", { stop: true }));
    projectDetail.mockResolvedValue({ services: [service("hangar", ["running"], "4a1b2c3d4e5f")] });

    await expect(job.run("hangar")).rejects.toThrow(/runs Hangar itself/);

    expect(compose).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("fails an app hangar.yml declares no backup for", async () => {
    backup.mockReturnValue(undefined);

    await expect(job.run("jellyfin")).rejects.toThrow(/declares no backup for jellyfin/);

    expect(create).not.toHaveBeenCalled();
  });
});
