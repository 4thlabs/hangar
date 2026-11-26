import type { ContainerMetrics } from "#libs/api";

/** How the page writes the metrics of the containers, in English: `1.5 MiB`, `12.0%`, a dash for no reading. */
export class MetricFormat {
  /** Binary units: the divisor is 1024, so these are KiB, MiB, GiB, not kB, MB, GB. */
  private static readonly ByteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

  private static readonly Amount = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

  /** A share to one decimal, always written: `12.0%`, not `12%`. */
  private static readonly Percent = new Intl.NumberFormat("en", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  /** What a figure the daemon did not give reads as. */
  static readonly None = "—";

  /** The metrics of a container before its first frame, or once it stopped. */
  static readonly NoMetrics: ContainerMetrics = {
    cpuPercent: null,
    memoryUsage: null,
    memoryLimit: null,
    memoryPercent: null,
    networkRx: null,
    networkTx: null,
    blockRead: null,
    blockWrite: null,
  };

  /** A size in bytes, in the largest unit it is at least one of. */
  static bytes(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return MetricFormat.None;
    }

    if (value === 0) {
      return "0 B";
    }

    const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), MetricFormat.ByteUnits.length - 1);

    return `${MetricFormat.Amount.format(value / 1024 ** unit)} ${MetricFormat.ByteUnits[unit]}`;
  }

  /** A share out of 100. */
  static percent(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return MetricFormat.None;
    }

    return MetricFormat.Percent.format(value / 100);
  }
}
