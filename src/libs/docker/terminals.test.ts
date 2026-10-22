import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { containerSource, dockerMock, fakeApps, fakeDockerode, givenContainers } = await import("./mock/index.ts");
const { Cache } = await import("#libs/cache");
const { Docker } = await import("./docker.ts");
const { DockerNotFoundError } = await import("./compose.ts");
const { ContainerTerminals } = await import("./terminals.ts");

const CONTAINER_ID = "a".repeat(64);
const SIZE = { cols: 100, rows: 30 };
const TARGET = { owner: "user-1", project: "alpha", containerId: CONTAINER_ID };

/** The shell exec of the last session opened, and the hang-up execs run since. */
let shell: { stream: PassThrough; start: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> };
let kills: { options: { Cmd: string[] }; start: ReturnType<typeof vi.fn> }[];

/** Terminals over the real `Docker` lookup, against the fake daemon. */
function terminals() {
  const dockerode = fakeDockerode();

  return new ContainerTerminals(dockerode, new Docker(dockerode, fakeApps("alpha"), new Cache()));
}

/** Lets the detached close (the hang-up exec) run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  kills = [];
  givenContainers([containerSource({ Id: CONTAINER_ID })]);
  dockerMock.exec.mockImplementation((_id: string, options: { AttachStdin?: boolean; Cmd: string[] }) => {
    if (options.AttachStdin) {
      const stream = new PassThrough();

      shell = { stream, start: vi.fn().mockResolvedValue(stream), resize: vi.fn().mockResolvedValue(undefined) };

      return Promise.resolve(shell);
    }

    const kill = { options, start: vi.fn().mockResolvedValue(undefined) };

    kills.push(kill);

    return Promise.resolve(kill);
  });
});

describe("ContainerTerminals.open", () => {
  it("starts a TTY shell in the project's container, sized and marked with the session id", async () => {
    const { id } = await terminals().open(TARGET, SIZE, new AbortController().signal);

    expect(dockerMock.exec).toHaveBeenCalledWith(
      CONTAINER_ID,
      expect.objectContaining({
        Tty: true,
        AttachStdin: true,
        ConsoleSize: [30, 100],
        Env: ["TERM=xterm-256color", `HANGAR_TERMINAL=${id}`],
      }),
    );

    expect(shell.start).toHaveBeenCalledWith({ hijack: true, stdin: true, Tty: true });
  });

  it("streams the shell's output", async () => {
    const { output } = await terminals().open(TARGET, SIZE, new AbortController().signal);

    shell.stream.write("/ # ");

    await expect(new Promise(resolve => output.once("data", resolve))).resolves.toEqual(Buffer.from("/ # "));
  });

  it("sends a byte the terminal ignores while the shell is idle, so no proxy times the stream out", async () => {
    vi.useFakeTimers();

    try {
      const { output } = await terminals().open(TARGET, SIZE, new AbortController().signal);

      vi.advanceTimersByTime(30_000);

      expect(output.read()).toEqual(Buffer.from("\0"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a container of another project without starting anything", async () => {
    givenContainers([
      containerSource({
        Id: CONTAINER_ID,
        labels: { "com.docker.compose.project": "beta", "com.docker.compose.service": "web" },
      }),
    ]);

    await expect(terminals().open(TARGET, SIZE, new AbortController().signal)).rejects.toBeInstanceOf(
      DockerNotFoundError,
    );

    expect(dockerMock.exec).not.toHaveBeenCalled();
  });
});

describe("ContainerTerminals.write and resize", () => {
  it("types into the shell and resizes its TTY", async () => {
    const subject = terminals();
    const { id } = await subject.open(TARGET, SIZE, new AbortController().signal);
    const typed = new Promise(resolve => shell.stream.once("data", resolve));

    subject.write(id, "user-1", "ls\r");
    await subject.resize(id, "user-1", { cols: 120, rows: 40 });

    await expect(typed).resolves.toEqual(Buffer.from("ls\r"));
    expect(shell.resize).toHaveBeenCalledWith({ h: 40, w: 120 });
  });

  it("answers its owner only", async () => {
    const subject = terminals();
    const { id } = await subject.open(TARGET, SIZE, new AbortController().signal);

    expect(() => subject.write(id, "user-2", "ls\r")).toThrow(DockerNotFoundError);
    await expect(subject.resize(id, "user-2", SIZE)).rejects.toBeInstanceOf(DockerNotFoundError);
  });
});

describe("ContainerTerminals closing", () => {
  it("hangs up the session's processes and forgets it when the client leaves", async () => {
    const subject = terminals();
    const controller = new AbortController();
    const { id } = await subject.open(TARGET, SIZE, controller.signal);

    controller.abort();
    await settle();

    expect(shell.stream.destroyed).toBe(true);
    // The marker goes as `$1`, which the script matches against each process's environment.
    expect(kills).toHaveLength(1);
    expect(kills[0]?.options.Cmd.at(-1)).toBe(id);
    expect(kills[0]?.start).toHaveBeenCalledWith({ Detach: true });
    expect(() => subject.write(id, "user-1", "ls\r")).toThrow(DockerNotFoundError);
  });

  it("closes a session whose client left while it opened", async () => {
    const controller = new AbortController();

    dockerMock.exec.mockImplementationOnce(() => {
      controller.abort();
      const stream = new PassThrough();

      shell = { stream, start: vi.fn().mockResolvedValue(stream), resize: vi.fn() };

      return Promise.resolve(shell);
    });

    await terminals().open(TARGET, SIZE, controller.signal);
    await settle();

    expect(shell.stream.destroyed).toBe(true);
    expect(kills).toHaveLength(1);
  });

  it("ends the output and forgets the session when the shell exits", async () => {
    const subject = terminals();
    const { id, output } = await subject.open(TARGET, SIZE, new AbortController().signal);
    const ended = new Promise(resolve => output.once("end", resolve));

    output.resume();
    shell.stream.end();

    await ended;
    await settle();
    expect(() => subject.write(id, "user-1", "ls\r")).toThrow(DockerNotFoundError);
    expect(kills).toHaveLength(1);
  });
});
