/** Display formatting for container metrics, shared by the container table and the app detail. */
const byteFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function formatBytes(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "0 B";

  // Binary units: the divisor below is 1024, so these are KiB/MiB/GiB, not KB/MB/GB.
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${byteFormatter.format(value / 1024 ** unit)} ${units[unit]}`;
}

export const formatPercent = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} %`);

/** French plural agreement: the `s` a noun or adjective takes past one. */
export const s = (count: number) => (count > 1 ? "s" : "");

/** A count and its noun, agreed: `2 applications`. */
export const plural = (count: number, word: string) => `${count} ${word}${s(count)}`;
