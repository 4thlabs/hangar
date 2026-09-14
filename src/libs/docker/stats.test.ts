import { describe, expect, it } from "vitest";
import { containerMetrics, type ContainerStatsSample } from "./stats.ts";

/** A stats sample with only the fields the derivation reads. */
const sample = ({
  cpu = 1_000_000,
  system = 10_000_000,
  cores = 4,
  usage = 200,
  cache = 50,
  limit = 1_000,
  networks = { eth0: { rx_bytes: 10, tx_bytes: 20 }, eth1: { rx_bytes: 5, tx_bytes: 1 } },
  blkio = [
    { op: "read", value: 300 },
    { op: "write", value: 400 },
    { op: "Read", value: 7 },
  ],
} = {}) =>
  ({
    cpu_stats: { cpu_usage: { total_usage: cpu }, system_cpu_usage: system, online_cpus: cores },
    memory_stats: { usage, limit, stats: { inactive_file: cache } },
    networks,
    blkio_stats: { io_service_bytes_recursive: blkio },
  }) as unknown as ContainerStatsSample;

describe("containerMetrics", () => {
  it("reports no CPU share for the first sample, having nothing to compare against", () => {
    expect(containerMetrics(sample()).cpuPercent).toBeNull();
  });

  it("derives the CPU share from the delta between two samples, scaled by the cores", () => {
    const previous = sample({ cpu: 1_000_000, system: 10_000_000 });
    // 1% of the host's time over the window, across 4 cores.
    const current = sample({ cpu: 1_100_000, system: 20_000_000, cores: 4 });

    expect(containerMetrics(current, previous).cpuPercent).toBeCloseTo(4, 5);
  });

  it("reports no CPU share when a restart resets the counter backwards", () => {
    const previous = sample({ cpu: 5_000_000, system: 10_000_000 });
    const current = sample({ cpu: 10_000, system: 20_000_000 });

    expect(containerMetrics(current, previous).cpuPercent).toBeNull();
  });

  it("subtracts the reclaimable page cache from the memory figure, as Docker's own does", () => {
    const metrics = containerMetrics(sample({ usage: 200, cache: 50, limit: 1_000 }));

    expect(metrics.memoryUsage).toBe(150);
    expect(metrics.memoryLimit).toBe(1_000);
    expect(metrics.memoryPercent).toBeCloseTo(15, 5);
  });

  it("falls back to the cgroup v1 spelling of the cache counter", () => {
    const v1 = {
      ...sample(),
      memory_stats: { usage: 200, limit: 1_000, stats: { total_inactive_file: 50 } },
    } as unknown as ContainerStatsSample;

    expect(containerMetrics(v1).memoryUsage).toBe(150);
  });

  it("sums every interface and every block device", () => {
    const metrics = containerMetrics(sample());

    expect(metrics.networkRx).toBe(15);
    expect(metrics.networkTx).toBe(21);
    // Docker spells the operation inconsistently across versions, so matching is case-insensitive.
    expect(metrics.blockRead).toBe(307);
    expect(metrics.blockWrite).toBe(400);
  });

  it("reports nulls rather than zeros when a counter is missing entirely", () => {
    const bare = { cpu_stats: { cpu_usage: {} }, memory_stats: {} } as unknown as ContainerStatsSample;
    const metrics = containerMetrics(bare);

    expect(metrics).toMatchObject({
      memoryUsage: null,
      memoryLimit: null,
      memoryPercent: null,
      networkRx: null,
      blockRead: null,
    });
  });
});
