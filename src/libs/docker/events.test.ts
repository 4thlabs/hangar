import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockerChange } from "./docker.ts";

// The pause before reconnecting is real seconds in production; here it is only an ordering point.
vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

const { dockerMock, fakeDockerode } = await import("./mock/index.ts");
const { DockerEvents } = await import("./events.ts");

/** One event as the daemon writes it: a JSON object on its own line. */
const line = (event: object) => `${JSON.stringify(event)}\n`;

const composeContainer = (action: string) => ({
  Type: "container",
  Action: action,
  Actor: { ID: "abc", Attributes: { "com.docker.compose.project": "alpha", name: "alpha-web-1" } },
});

let events: InstanceType<typeof DockerEvents>;
let changes: DockerChange[];

/** Starts following a stream the test writes to, and lets the connection's own batches drain. */
const follow = async () => {
  const stream = new PassThrough();
  dockerMock.getEvents.mockResolvedValueOnce(stream);

  events.start();
  await vi.advanceTimersByTimeAsync(2_000);
  changes.length = 0;

  return stream;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  changes = [];
  events = new DockerEvents(fakeDockerode(), change => changes.push(change));
});

afterEach(() => {
  events.stop();
  vi.useRealTimers();
});

describe("DockerEvents.changesOf", () => {
  it("refreshes the containers for a Compose container, and the overview for any container", () => {
    expect(DockerEvents.changesOf(composeContainer("start"))).toEqual(["containers", "overview"]);
    expect(DockerEvents.changesOf({ Type: "container", Actor: { Attributes: { name: "loose" } } })).toEqual([
      "overview",
    ]);
  });

  it("refreshes the image list for an image, and the overview for an image or a volume", () => {
    expect(DockerEvents.changesOf({ Type: "image" })).toEqual(["images", "overview"]);
    expect(DockerEvents.changesOf({ Type: "volume" })).toEqual(["overview"]);
    expect(DockerEvents.changesOf({ Type: "network" })).toEqual([]);
  });
});

describe("DockerEvents", () => {
  it("reports everything as stale once connected: nothing was listening before", async () => {
    dockerMock.getEvents.mockResolvedValueOnce(new PassThrough());

    events.start();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(changes.sort()).toEqual(["containers", "images", "overview"]);
  });

  it("asks the daemon only for the actions that move a cached read", async () => {
    await follow();

    const [options] = dockerMock.getEvents.mock.calls[0] as [{ filters: { type: string[]; event: string[] } }];

    expect(options.filters.type).toEqual(["container", "image", "volume"]);
    expect(options.filters.event).toContain("health_status");
    expect(options.filters.event).not.toContain("exec_start");
  });

  it("turns a burst of events into one refresh per kind", async () => {
    const stream = await follow();

    stream.write(line(composeContainer("create")) + line(composeContainer("start")));
    stream.write(line(composeContainer("health_status: healthy")));
    await vi.advanceTimersByTimeAsync(250);

    // The containers go first; the overview, behind the slow `df`, waits for the burst to finish.
    expect(changes).toEqual(["containers"]);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(changes).toEqual(["containers", "overview"]);
  });

  it("does not let a steady trickle postpone the refresh", async () => {
    const stream = await follow();

    for (let tick = 0; tick < 5; tick++) {
      stream.write(line(composeContainer("start")));
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(changes).toContain("containers");
  });

  it("reads an event split across two chunks once it is whole", async () => {
    const stream = await follow();
    const event = line({ Type: "image", Action: "pull" });

    stream.write(event.slice(0, 10));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(changes).toEqual([]);

    stream.write(event.slice(10));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(changes.sort()).toEqual(["images", "overview"]);
  });

  it("skips a line it cannot read and keeps following", async () => {
    const stream = await follow();

    stream.write("not json\n" + line({ Type: "volume", Action: "destroy" }));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(changes).toEqual(["overview"]);
  });

  it("reconnects when the stream ends, and reports everything again", async () => {
    const first = await follow();
    dockerMock.getEvents.mockResolvedValueOnce(new PassThrough());

    first.end();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(dockerMock.getEvents).toHaveBeenCalledTimes(2);
    expect(changes.sort()).toEqual(["containers", "images", "overview"]);
  });

  it("keeps trying while the daemon is unreachable", async () => {
    dockerMock.getEvents.mockRejectedValueOnce(new Error("socket gone")).mockResolvedValueOnce(new PassThrough());

    events.start();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(dockerMock.getEvents).toHaveBeenCalledTimes(2);
    expect(changes.sort()).toEqual(["containers", "images", "overview"]);
  });

  it("tears the stream down and reports nothing more once stopped", async () => {
    const stream = await follow();
    const [options] = dockerMock.getEvents.mock.calls[0] as [{ abortSignal: AbortSignal }];

    events.stop();
    stream.write(line(composeContainer("die")));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(options.abortSignal.aborted).toBe(true);
    expect(changes).toEqual([]);
  });
});
