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
 * One container's resource usage, derived from a raw Engine API stats sample and the one before
 * it. Pure — it only reads the two samples it was handed, so it never touches the daemon.
 *
 * {@link metrics} returns a plain object on purpose, not the instance: it crosses the RSC
 * boundary into client components, and that serialization does not carry classes.
 */
export class ContainerStats {
  /** The sample just taken. */
  private readonly sample: ContainerStatsSample;

  /** The sample before it; absent on a container's first frame. */
  private readonly previous: ContainerStatsSample | undefined;

  /**
   * @param sample The sample just taken
   * @param previous The sample before it, needed for the CPU delta; omit it on the first one
   */
  constructor(sample: ContainerStatsSample, previous?: ContainerStatsSample | undefined) {
    this.sample = sample;
    this.previous = previous;
  }

  /**
   * CPU time is a counter, so a percentage only exists between two samples: the container's own
   * delta over the host's, scaled by the cores it may use. The very first sample of a container
   * has nothing to compare against and reports `null` rather than a misleading zero.
   */
  private cpuPercent(): number | null {
    if (!this.previous) return null;

    const { cpu_stats: current } = this.sample;
    const used = current.cpu_usage.total_usage - this.previous.cpu_stats.cpu_usage.total_usage;
    const available = current.system_cpu_usage - this.previous.cpu_stats.system_cpu_usage;
    const cores = current.online_cpus || current.cpu_usage.percpu_usage?.length || 1;

    // A restarted container resets its counter, which would otherwise read as a negative share.
    if (available <= 0 || used < 0) return null;

    return (used / available) * cores * 100;
  }

  /**
   * Docker's own memory figure subtracts the page cache, which is reclaimable and would otherwise
   * make an idle container look like it is holding hundreds of megabytes it does not need.
   */
  private memoryUsage(): number | null {
    const usage = this.sample.memory_stats.usage;
    if (usage === undefined) return null;

    const stats = this.sample.memory_stats.stats as Record<string, number> | undefined;
    // cgroup v2 calls it `inactive_file`; v1 called it `total_inactive_file`.
    const cache = stats?.inactive_file ?? stats?.total_inactive_file ?? 0;

    return Math.max(usage - cache, 0);
  }

  /** Sums one direction across every network interface the container is attached to. */
  private network(direction: "rx_bytes" | "tx_bytes"): number | null {
    const interfaces = Object.values(this.sample.networks ?? {});

    return interfaces.length > 0 ? interfaces.reduce((total, entry) => total + entry[direction], 0) : null;
  }

  /** Sums one block I/O operation across every backing device. */
  private blockIo(operation: "read" | "write"): number | null {
    const entries = this.sample.blkio_stats?.io_service_bytes_recursive;
    if (!entries) return null;

    return entries
      .filter(entry => entry.op.toLowerCase() === operation)
      .reduce((total, entry) => total + entry.value, 0);
  }

  /** The UI-facing view of this sample. */
  metrics(): ContainerMetrics {
    const usage = this.memoryUsage();
    const limit = this.sample.memory_stats.limit ?? null;

    return {
      cpuPercent: this.cpuPercent(),
      memoryUsage: usage,
      memoryLimit: limit,
      memoryPercent: usage !== null && limit ? (usage / limit) * 100 : null,
      networkRx: this.network("rx_bytes"),
      networkTx: this.network("tx_bytes"),
      blockRead: this.blockIo("read"),
      blockWrite: this.blockIo("write"),
    };
  }
}
