import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./client.ts", async () => ({ docker: (await import("./docker-mock.ts")).docker }));

const { containerSource, dockerMock, givenContainers } = await import("./docker-mock.ts");
const { openDockerLogs } = await import("./logs.ts");
const { DockerNotFoundError } = await import("./projects.ts");

const CONTAINER_ID = "a".repeat(64);
const container = (labels: Record<string, string>, tty = false) => containerSource({ Id: CONTAINER_ID, labels, tty });

describe("openDockerLogs", () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerMock.logs.mockImplementation(() => Promise.resolve(new PassThrough()));
    // Demuxing is the daemon's framing, not this module's logic: pass the bytes straight through.
    dockerMock.demuxStream.mockImplementation((source: PassThrough, out: PassThrough) => source.pipe(out));
  });

  it("rejects a malformed container id without touching Docker", async () => {
    givenContainers([]);

    await expect(openDockerLogs("alpha", "not-an-id", signal)).rejects.toBeInstanceOf(DockerNotFoundError);
    expect(dockerMock.listContainers).not.toHaveBeenCalled();
  });

  it("rejects a container that does not belong to the requested project", async () => {
    // The project filter means another project's container simply isn't in the list.
    givenContainers([container({ "com.docker.compose.project": "beta", "com.docker.compose.service": "web" })]);

    await expect(openDockerLogs("alpha", CONTAINER_ID, signal)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it("rejects a one-off container even inside the right project", async () => {
    givenContainers([
      container({
        "com.docker.compose.project": "alpha",
        "com.docker.compose.service": "web",
        "com.docker.compose.oneoff": "True",
      }),
    ]);

    await expect(openDockerLogs("alpha", CONTAINER_ID, signal)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it("follows the container's output from the tail", async () => {
    givenContainers([container({ "com.docker.compose.project": "alpha", "com.docker.compose.service": "web" })]);
    const source = new PassThrough();
    dockerMock.logs.mockResolvedValue(source);

    const stream = await openDockerLogs("alpha", CONTAINER_ID, signal);
    source.write("hello\n");

    await expect(new Promise(resolve => stream.once("data", resolve))).resolves.toEqual(Buffer.from("hello\n"));
    expect(dockerMock.logs).toHaveBeenCalledWith(
      CONTAINER_ID,
      expect.objectContaining({ follow: true, stdout: true, stderr: true, tail: 200, timestamps: true }),
    );
  });

  it("demuxes a non-TTY container and pipes a TTY one straight through", async () => {
    givenContainers([container({ "com.docker.compose.project": "alpha", "com.docker.compose.service": "web" })]);
    await openDockerLogs("alpha", CONTAINER_ID, signal);
    expect(dockerMock.demuxStream).toHaveBeenCalled();

    vi.clearAllMocks();
    dockerMock.logs.mockResolvedValue(new PassThrough());
    givenContainers([container({ "com.docker.compose.project": "alpha", "com.docker.compose.service": "web" }, true)]);

    await openDockerLogs("alpha", CONTAINER_ID, signal);
    expect(dockerMock.demuxStream).not.toHaveBeenCalled();
  });

  it("tears the log stream down when the request is aborted", async () => {
    givenContainers([container({ "com.docker.compose.project": "alpha", "com.docker.compose.service": "web" })]);
    const source = new PassThrough();
    dockerMock.logs.mockResolvedValue(source);
    const controller = new AbortController();

    await openDockerLogs("alpha", CONTAINER_ID, controller.signal);
    controller.abort();

    expect(source.destroyed).toBe(true);
  });
});
