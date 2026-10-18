import { beforeEach, describe, expect, it, vi } from "vitest";

const { dockerMock, fakeDockerode } = await import("./mock/index.ts");
const { DockerSelfUpdate, SelfUpdateUnavailableError } = await import("./self-update.ts");

const HANGAR_ID = "4f1c2a9e7b3d";

/** Hangar's container as Compose creates it from `/srv/hangar/compose.yml`. */
const hangarContainer = {
  Image: "sha256:current",
  Config: {
    Image: "ghcr.io/4thlabs/hangar:latest",
    Labels: {
      "com.docker.compose.project": "hangar",
      "com.docker.compose.service": "hangar",
      "com.docker.compose.project.working_dir": "/srv/hangar",
      "com.docker.compose.project.config_files": "/srv/hangar/compose.yml,/srv/shared/proxy.yml",
    },
  },
  Mounts: [{ Source: "/run/docker.sock", Destination: "/var/run/docker.sock" }],
};

const notFound = Object.assign(new Error("no such container"), { statusCode: 404 });

/** The daemon knows Hangar's container as given, and the relay as given (`null`: none yet). */
function given(hangar: unknown, relay: { State: { Running: boolean } } | null = null) {
  dockerMock.inspect.mockImplementation(async (id: string) => {
    const container = id === HANGAR_ID ? hangar : relay;

    if (!container) {
      throw notFound;
    }

    return container;
  });
}

const selfUpdate = () => new DockerSelfUpdate(fakeDockerode(), HANGAR_ID);

beforeEach(() => {
  vi.clearAllMocks();
  dockerMock.createContainer.mockResolvedValue("relay-id");
});

describe("DockerSelfUpdate.target", () => {
  it("reads the project, the service and the image Compose started Hangar from", async () => {
    given(hangarContainer);

    await expect(selfUpdate().target()).resolves.toEqual({
      image: "ghcr.io/4thlabs/hangar:latest",
      project: "hangar",
      service: "hangar",
      workingDir: "/srv/hangar",
      configFiles: ["/srv/hangar/compose.yml", "/srv/shared/proxy.yml"],
    });
  });

  it("says Hangar runs outside a container when its hostname names none", async () => {
    given(null);

    await expect(selfUpdate().target()).rejects.toThrow(SelfUpdateUnavailableError);
  });

  it("says Hangar was not started with Compose when the labels are missing", async () => {
    given({ ...hangarContainer, Config: { ...hangarContainer.Config, Labels: {} } });

    await expect(selfUpdate().target()).rejects.toThrow("Hangar n’a pas été lancé avec Docker Compose.");
  });

  it("passes on a daemon that cannot be reached instead of blaming the setup", async () => {
    dockerMock.inspect.mockRejectedValue(new Error("connect ENOENT /var/run/docker.sock"));

    await expect(selfUpdate().target()).rejects.toThrow("connect ENOENT");
  });
});

describe("DockerSelfUpdate.start", () => {
  it("starts a relay from the running image that pulls, then recreates Hangar alone", async () => {
    given(hangarContainer);

    await selfUpdate().start();

    expect(dockerMock.createContainer).toHaveBeenCalledWith({
      name: "hangar-self-update",
      Image: "sha256:current",
      Entrypoint: [
        "sh",
        "-c",
        DockerSelfUpdate.Script,
        "sh",
        "-p",
        "hangar",
        "--project-directory",
        "/srv/hangar",
        "-f",
        "/srv/hangar/compose.yml",
        "-f",
        "/srv/shared/proxy.yml",
      ],
      Cmd: [],
      Env: ["SERVICE=hangar"],
      WorkingDir: "/srv/hangar",
      HostConfig: {
        Binds: ["/run/docker.sock:/var/run/docker.sock", "/srv/hangar:/srv/hangar", "/srv/shared:/srv/shared"],
      },
    });

    expect(dockerMock.startContainer).toHaveBeenCalledWith("relay-id");
    expect(DockerSelfUpdate.Script).toContain("up -d --no-deps");
  });

  it("clears the relay a previous update left behind", async () => {
    given(hangarContainer, { State: { Running: false } });

    await selfUpdate().start();

    expect(dockerMock.removeContainer).toHaveBeenCalledWith("hangar-self-update");
    expect(dockerMock.startContainer).toHaveBeenCalled();
  });

  it("refuses a second update while the first one still runs", async () => {
    given(hangarContainer, { State: { Running: true } });

    await expect(selfUpdate().start()).rejects.toThrow("Une mise à jour de Hangar est déjà en cours.");
    expect(dockerMock.removeContainer).not.toHaveBeenCalled();
    expect(dockerMock.createContainer).not.toHaveBeenCalled();
  });
});
