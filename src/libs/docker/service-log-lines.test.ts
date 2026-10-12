import { describe, expect, it } from "vitest";
import { ServiceLogLines } from "./service-log-lines.ts";

const labels = new Map([["t1", "miniflux_web.1@nas"]]);

const context = "com.docker.swarm.node.id=nas,com.docker.swarm.service.id=web,com.docker.swarm.task.id=t1";

/** Writes the chunks one by one, then reads everything the transform gives back. */
const transform = async (...chunks: (string | Buffer)[]) => {
  const lines = new ServiceLogLines(labels);
  let text = "";

  lines.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });

  const ended = new Promise(resolve => lines.on("end", resolve));

  for (const chunk of chunks) {
    lines.write(chunk);
  }

  lines.end();
  await ended;

  return text;
};

describe("ServiceLogLines.format", () => {
  it("swaps the swarm context for the task's label, keeping the timestamp and the message", () => {
    expect(ServiceLogLines.format(`2026-10-11T10:00:00Z ${context} GET /health 200`, labels)).toBe(
      "2026-10-11T10:00:00Z miniflux_web.1@nas | GET /health 200",
    );
  });

  it("reads the task among the operator's own log details, in any order", () => {
    const details = `com.docker.swarm.task.id=t1,env=prod%20eu,com.docker.swarm.node.id=nas`;

    expect(ServiceLogLines.format(`2026-10-11T10:00:00Z ${details} ok`, labels)).toBe(
      "2026-10-11T10:00:00Z miniflux_web.1@nas | ok",
    );
  });

  it("shows a task started after the stream opened by its short id", () => {
    const line = "2026-10-11T10:00:00Z com.docker.swarm.task.id=abcdefghijklmnopqrstuvwxyz ok";

    expect(ServiceLogLines.format(line, labels)).toBe("2026-10-11T10:00:00Z abcdefghijkl | ok");
  });

  it("keeps an empty message, and leaves a line without the context as it is", () => {
    expect(ServiceLogLines.format(`2026-10-11T10:00:00Z ${context}`, labels)).toBe(
      "2026-10-11T10:00:00Z miniflux_web.1@nas | ",
    );

    expect(ServiceLogLines.format("2026-10-11T10:00:00Z plain message", labels)).toBe(
      "2026-10-11T10:00:00Z plain message",
    );

    expect(ServiceLogLines.format("", labels)).toBe("");
  });
});

describe("ServiceLogLines", () => {
  it("rewrites whole lines, whatever the chunks, a character split across two included", async () => {
    const line = Buffer.from(`2026-10-11T10:00:00Z ${context} café\n`);
    const splitInsideE = line.length - 2;

    await expect(
      transform(line.subarray(0, 30), line.subarray(30, splitInsideE), line.subarray(splitInsideE)),
    ).resolves.toBe("2026-10-11T10:00:00Z miniflux_web.1@nas | café\n");
  });

  it("gives back a last line that has no newline once the stream ends", async () => {
    await expect(transform(`2026-10-11T10:00:00Z ${context} bye`)).resolves.toBe(
      "2026-10-11T10:00:00Z miniflux_web.1@nas | bye",
    );
  });
});
