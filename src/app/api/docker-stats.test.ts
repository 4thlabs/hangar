import { beforeEach, describe, expect, it, vi } from "vitest";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build. `docker-route.ts` next door is what the
// 401/404/503 assertions below actually exercise.
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), logger: { error: vi.fn() } }));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth", () => ({ getSession: mocks.getSession }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
// One small singleton stands in for the whole layer: the class itself is tested against a fake
// client in `src/libs/docker/docker.test.ts`.
vi.mock("#libs/docker/server", async () => {
  const { Docker } = await import("#libs/docker/docker.ts");
  const { fakeApps, fakeDockerode } = await import("#libs/docker/docker-mock.ts");

  return { docker: new Docker(fakeDockerode(), fakeApps("alpha")) };
});

const { containerSource, dockerMock, givenContainers } = await import("#libs/docker/docker-mock.ts");
const { GET } = await import("#app/pages/_api/api/docker/stats.ts");

/** A stats sample whose CPU counters are `previous + delta`, so the second frame has a percentage. */
const statsSample = (used: number) => ({
  cpu_stats: { cpu_usage: { total_usage: used }, system_cpu_usage: used * 10, online_cpus: 1 },
  memory_stats: { usage: 1_024, limit: 2_048, stats: {} },
});

/** Reads frames off the event stream until `count` have arrived, then aborts the request. */
async function readFrames(response: Response, controller: AbortController, count: number) {
  const frames: string[] = [];
  const decoder = new TextDecoder();

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    frames.push(decoder.decode(chunk));
    if (frames.length === count) break;
  }

  controller.abort();
  return frames.map(frame => JSON.parse(frame.replace(/^data: /, "")) as Record<string, { cpuPercent: number | null }>);
}

describe("GET Docker container statistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "1" } });
    givenContainers([containerSource()]);
  });

  it("returns 401 before sampling the daemon", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/docker/stats"));

    expect(response.status).toBe(401);
    expect(dockerMock.listContainers).not.toHaveBeenCalled();
  });

  it("streams frames as bytes, with the CPU delta only from the second one", async () => {
    let used = 0;
    dockerMock.stats.mockImplementation(() => Promise.resolve(statsSample((used += 100))));
    const controller = new AbortController();

    const response = await GET(new Request("http://localhost/api/docker/stats", { signal: controller.signal }));
    const [first, second] = await readFrames(response, controller, 2);

    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    // Nothing to diff the first sample against: unknown, not a misleading zero.
    expect(first?.["container-1"]?.cpuPercent).toBeNull();
    expect(second?.["container-1"]?.cpuPercent).toBe(10);
  });

  it("returns 503 without leaking transport errors when the daemon is unreachable", async () => {
    dockerMock.listContainers.mockRejectedValue(new Error("private socket detail"));

    const response = await GET(new Request("http://localhost/api/docker/stats"));
    const body = (await response.json()) as { error: { message: string } };

    // A failure before the first frame still has a status line to spend: spend it.
    expect(response.status).toBe(503);
    expect(body.error.message).not.toContain("private socket detail");
  });

  it("ends the stream when the daemon goes away after the first frame", async () => {
    dockerMock.stats.mockResolvedValue(statsSample(100));
    const controller = new AbortController();

    const response = await GET(new Request("http://localhost/api/docker/stats", { signal: controller.signal }));
    // The status line is already sent, so the second sample failing can only end the stream.
    dockerMock.listContainers.mockRejectedValue(new Error("private socket detail"));

    const body = await response.text();

    expect(response.status).toBe(200);
    // The good first frame is delivered, and the stream stops there rather than hanging.
    expect(body.match(/^data: /gm)).toHaveLength(1);
    expect(body).toContain('"memoryUsage":1024');
    controller.abort();
  });
});
