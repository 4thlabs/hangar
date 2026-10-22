import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { containerSource, dockerMock, fakeApps, fakeDockerode, givenContainers } = await import("./mock/index.ts");
const { Cache } = await import("#libs/cache");
const { Docker } = await import("./docker.ts");
const { DockerNotFoundError } = await import("./compose.ts");
const { ContainerShells } = await import("./shells.ts");

const CONTAINER_ID = "a".repeat(64);
const SIZE = { cols: 100, rows: 30 };
const TARGET = { project: "alpha", containerId: CONTAINER_ID };

/** The shell exec of the last shell opened, and the hang-up execs run since. */
let exec: { stream: PassThrough; start: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> };
let kills: { options: { Cmd: string[] }; start: ReturnType<typeof vi.fn> }[];

/** Shells over the real `Docker` lookup, against the fake daemon. */
function shells() {
  const dockerode = fakeDockerode();

  return new ContainerShells(dockerode, new Docker(dockerode, fakeApps("alpha"), new Cache()));
}

beforeEach(() => {
  vi.clearAllMocks();
  kills = [];
  givenContainers([containerSource({ Id: CONTAINER_ID })]);
  dockerMock.exec.mockImplementation((_id: string, options: { AttachStdin?: boolean; Cmd: string[] }) => {
    if (options.AttachStdin) {
      const stream = new PassThrough();

      exec = { stream, start: vi.fn().mockResolvedValue(stream), resize: vi.fn().mockResolvedValue(undefined) };

      return Promise.resolve(exec);
    }

    const kill = { options, start: vi.fn().mockResolvedValue(undefined) };

    kills.push(kill);

    return Promise.resolve(kill);
  });
});

describe("ContainerShells.open", () => {
  it("starts a TTY shell in the project's container, sized and marked", async () => {
    const shell = await shells().open(TARGET, SIZE);

    expect(dockerMock.exec).toHaveBeenCalledWith(
      CONTAINER_ID,
      expect.objectContaining({
        Tty: true,
        AttachStdin: true,
        ConsoleSize: [30, 100],
        Env: ["TERM=xterm-256color", expect.stringMatching(/^HANGAR_TERMINAL=.+/)],
      }),
    );

    expect(exec.start).toHaveBeenCalledWith({ hijack: true, stdin: true, Tty: true });
    expect(shell.stream).toBe(exec.stream);
    expect(shell.target).toEqual({ project: "alpha", container: CONTAINER_ID });
  });

  it("rejects a container of another project without starting anything", async () => {
    givenContainers([
      containerSource({
        Id: CONTAINER_ID,
        labels: { "com.docker.compose.project": "beta", "com.docker.compose.service": "web" },
      }),
    ]);

    await expect(shells().open(TARGET, SIZE)).rejects.toBeInstanceOf(DockerNotFoundError);

    expect(dockerMock.exec).not.toHaveBeenCalled();
  });
});

describe("ContainerShells shell", () => {
  it("resizes the exec's TTY", async () => {
    const shell = await shells().open(TARGET, SIZE);

    await shell.resize({ cols: 120, rows: 40 });

    expect(exec.resize).toHaveBeenCalledWith({ h: 40, w: 120 });
  });

  it("ends by hanging up every process carrying its marker", async () => {
    const shell = await shells().open(TARGET, SIZE);
    const [, marker] = (dockerMock.exec.mock.calls[0]?.[1] as { Env: string[] }).Env[1]!.split("=");

    await shell.end();

    // The marker goes as `$1`, which the script matches against each process's environment.
    expect(kills).toHaveLength(1);
    expect(kills[0]?.options.Cmd.at(-1)).toBe(marker);
    expect(kills[0]?.start).toHaveBeenCalledWith({ Detach: true });
  });
});
