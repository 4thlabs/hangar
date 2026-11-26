import type { ContainerMetrics } from "#libs/api";

// How the page writes the metrics of the containers, in English: `1.5 MiB`, `12.0%`, a dash for no reading.

/** Binary units: the divisor is 1024, so these are KiB, MiB, GiB, not kB, MB, GB. */
const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

const amountFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** A share to one decimal, always written: `12.0%`, not `12%`. */
const percentFormat = new Intl.NumberFormat("en", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** What a figure the daemon did not give reads as. */
export const noReading = "—";

/** The metrics of a container before its first frame, or once it stopped. */
export const noMetrics: ContainerMetrics = {
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
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return noReading;
  }

  if (value === 0) {
    return "0 B";
  }

  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), byteUnits.length - 1);

  return `${amountFormat.format(value / 1024 ** unit)} ${byteUnits[unit]}`;
}

/** A share out of 100. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return noReading;
  }

  return percentFormat.format(value / 100);
}
