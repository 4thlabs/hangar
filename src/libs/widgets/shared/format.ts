/** Counts, as the widget metrics render them. */
export const integerFormatter = new Intl.NumberFormat("en-US");

/** Bytes as gigabytes, the unit Docker disk usage is read in. */
export const formatGigabytes = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(1)} GB`;

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Bytes in whichever unit keeps the number readable.
 *
 * Not {@link formatGigabytes}, which is fixed to GB on purpose: a backup repository holds terabytes,
 * and `1433.6 GB` in a header subtitle is a number nobody reads. Decimal-free below MB — a count of
 * bytes has no meaningful fraction — and one decimal above.
 */
export function formatBytes(bytes: number) {
  const magnitude = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  const unit = Math.min(magnitude, BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;

  return `${value.toFixed(unit < 2 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}
