import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockerNotFoundError, type ComposeProjectDetail } from "#libs/docker";

const mocks = vi.hoisted(() => ({
  installed: new Set<string>(),
  projectDetail: vi.fn<(project: string) => Promise<ComposeProjectDetail>>(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { require: vi.fn(async () => ({ user: { id: "1" } })) } }));
vi.mock("#libs/docker/server", () => ({ docker: { projectDetail: mocks.projectDetail } }));
vi.mock("#libs/logs", () => ({ logger: { error: mocks.logError } }));

vi.mock("#libs/hangar/server", () => ({
  hangar: { store: { app: (id: string) => ({ id, installed: mocks.installed.has(id) }) } },
}));

const { readAppServices } = await import("#modules/store/actions/read-app-services.ts");

const detail = (services: ComposeProjectDetail["services"]): ComposeProjectDetail => ({
  name: "immich",
  status: services.length > 0 ? "running" : "stopped",
  serviceCount: services.length,
  runningCount: 0,
  unhealthyCount: 0,
  containerIds: [],
  services,
});

describe("readAppServices", () => {
  beforeEach(() => {
    mocks.installed = new Set(["immich"]);
    mocks.projectDetail.mockReset();
    mocks.logError.mockReset();
  });

  it("reads the services of an installed app", async () => {
    const loaded = detail([{ name: "server", status: "running", runningCount: 0, unhealthyCount: 0, containers: [] }]);

    mocks.projectDetail.mockResolvedValue(loaded);

    expect(await readAppServices("immich")).toEqual({ state: "loaded", detail: loaded });
  });

  it("does not ask Docker about an app that is not installed", async () => {
    expect(await readAppServices("jellyfin")).toEqual({ state: "absent" });
    expect(mocks.projectDetail).not.toHaveBeenCalled();
  });

  it("reads an installed app without containers as absent, taken down or never started", async () => {
    mocks.projectDetail.mockResolvedValueOnce(detail([]));
    mocks.projectDetail.mockRejectedValueOnce(new DockerNotFoundError("Compose project immich"));

    expect(await readAppServices("immich")).toEqual({ state: "absent" });
    expect(await readAppServices("immich")).toEqual({ state: "absent" });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("logs a daemon that does not answer, and reads it as unavailable", async () => {
    mocks.projectDetail.mockRejectedValue(new Error("connect ENOENT /var/run/docker.sock"));

    expect(await readAppServices("immich")).toEqual({ state: "unavailable" });
    expect(mocks.logError).toHaveBeenCalledWith("Failed to read the services of an app", expect.anything());
  });
});
