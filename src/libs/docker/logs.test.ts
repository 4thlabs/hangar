import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "#libs/hangar";

vi.mock("server-only", () => ({}));

const { openDockerLogs } = await import("./logs.ts");
const { DockerNotFoundError } = await import("./projects.ts");

const CONTAINER_ID = "a".repeat(64);

const inspected = (labels: Record<string, string>) => ({
  Id: CONTAINER_ID,
  Name: "/alpha-web-1",
  RestartCount: 0,
  State: { Status: "running" },
  Config: { Image: "nginx", Labels: labels },
  NetworkSettings: { Ports: {} },
});

/** A runner that lists the given containers, and streams `logs` output into the piped stream. */
const runnerFor = (containers: ReturnType<typeof inspected>[]): CommandRunner => ({
  run: vi.fn(async (_command: string, args: string[], options = {}) => {
    if (args[0] === "logs") {
      options.pipe?.write("hello\n");
      return { code: 0, stdout: "" };
    }

    return {
      code: 0,
      stdout: (args[0] === "ps"
        ? containers.map(entry => entry.Id)
        : containers.map(entry => JSON.stringify(entry))
      ).join("\n"),
    };
  }),
});

describe("openDockerLogs", () => {
  const signal = new AbortController().signal;

  it("rejects a malformed container id without touching Docker", async () => {
    const runner = runnerFor([]);

    await expect(openDockerLogs(runner, "alpha", "not-an-id", signal)).rejects.toBeInstanceOf(DockerNotFoundError);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects a container that does not belong to the requested project", async () => {
    // The project filter means another project's container simply isn't in the list.
    await expect(openDockerLogs(runnerFor([]), "alpha", CONTAINER_ID, signal)).rejects.toBeInstanceOf(
      DockerNotFoundError,
    );
  });

  it("rejects a one-off container even inside the right project", async () => {
    const runner = runnerFor([
      inspected({ "com.docker.compose.project": "alpha", "com.docker.compose.oneoff": "True" }),
    ]);

    await expect(openDockerLogs(runner, "alpha", CONTAINER_ID, signal)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it("streams the container's output and passes the abort signal to the child", async () => {
    const runner = runnerFor([inspected({ "com.docker.compose.project": "alpha" })]);

    const stream = await openDockerLogs(runner, "alpha", CONTAINER_ID, signal);

    await expect(new Promise(resolve => stream.once("data", resolve))).resolves.toEqual(Buffer.from("hello\n"));
    expect(runner.run).toHaveBeenLastCalledWith(
      "docker",
      ["logs", "-f", "--tail", "200", "--timestamps", CONTAINER_ID],
      expect.objectContaining({ signal }),
    );
  });
});
