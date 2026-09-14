import type Docker from "dockerode";

/** One raw sample from the Engine API's container stats endpoint. */
export type ContainerStatsSample = Docker.ContainerStats;

/** Point-in-time resource usage for a single container; a field is `null` when it could not be derived. */
export type ContainerMetrics = {
  cpuPercent: number | null;
  memoryUsage: number | null;
  memoryLimit: number | null;
  memoryPercent: number | null;
  networkRx: number | null;
  networkTx: number | null;
  blockRead: number | null;
  blockWrite: number | null;
};

/**
 * CPU time is a counter, so a percentage only exists between two samples: the container's own
 * delta over the host's, scaled by the cores it may use. The very first sample of a container
 * has nothing to compare against and reports `null` rather than a misleading zero.
 */
function cpuPercent(sample: ContainerStatsSample, previous: ContainerStatsSample | undefined): number | null {
  if (!previous) return null;

  const used = sample.cpu_stats.cpu_usage.total_usage - previous.cpu_stats.cpu_usage.total_usage;
  const available = sample.cpu_stats.system_cpu_usage - previous.cpu_stats.system_cpu_usage;
  const cores = sample.cpu_stats.online_cpus || sample.cpu_stats.cpu_usage.percpu_usage?.length || 1;

  // A restarted container resets its counter, which would otherwise read as a negative share.
  if (available <= 0 || used < 0) return null;

  return (used / available) * cores * 100;
}

/**
 * Docker's own memory figure subtracts the page cache, which is reclaimable and would otherwise
 * make an idle container look like it is holding hundreds of megabytes it does not need.
 */
function memoryUsage(sample: ContainerStatsSample): number | null {
  const usage = sample.memory_stats.usage;
  if (usage === undefined) return null;

  const stats = sample.memory_stats.stats as Record<string, number> | undefined;
  // cgroup v2 calls it `inactive_file`; v1 called it `total_inactive_file`.
  const cache = stats?.inactive_file ?? stats?.total_inactive_file ?? 0;

  return Math.max(usage - cache, 0);
}

/** Sums one direction across every network interface the container is attached to. */
const network = (sample: ContainerStatsSample, direction: "rx_bytes" | "tx_bytes"): number | null => {
  const interfaces = Object.values(sample.networks ?? {});

  return interfaces.length > 0 ? interfaces.reduce((total, entry) => total + entry[direction], 0) : null;
};

/** Sums one block I/O operation across every backing device. */
const blockIo = (sample: ContainerStatsSample, operation: "read" | "write"): number | null => {
  const entries = sample.blkio_stats?.io_service_bytes_recursive;
  if (!entries) return null;

  return entries.filter(entry => entry.op.toLowerCase() === operation).reduce((total, entry) => total + entry.value, 0);
};

/**
 * Derives the UI-facing {@link ContainerMetrics} from one raw Engine API stats sample.
 * @param sample The sample just taken
 * @param previous The sample before it, needed for the CPU delta; omit it on the first one
 */
export function containerMetrics(
  sample: ContainerStatsSample,
  previous?: ContainerStatsSample | undefined,
): ContainerMetrics {
  const usage = memoryUsage(sample);
  const limit = sample.memory_stats.limit ?? null;

  return {
    cpuPercent: cpuPercent(sample, previous),
    memoryUsage: usage,
    memoryLimit: limit,
    memoryPercent: usage !== null && limit ? (usage / limit) * 100 : null,
    networkRx: network(sample, "rx_bytes"),
    networkTx: network(sample, "tx_bytes"),
    blockRead: blockIo(sample, "read"),
    blockWrite: blockIo(sample, "write"),
  };
}
