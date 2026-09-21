/** Counts, as the widget metrics render them. */
export const integerFormatter = new Intl.NumberFormat("en-US");

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Bytes in whichever unit keeps the number readable.
 *
 * Decimal-free below MB — a count of bytes has no meaningful fraction — and one decimal above. The
 * unit floats rather than being pinned to GB: a host with 700 MB of images reads better than
 * `0.7 GB`, and a backup repository holding terabytes very much better than `1433.6 GB`.
 */
export function formatBytes(bytes: number) {
  const magnitude = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  const unit = Math.min(magnitude, BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;

  return `${value.toFixed(unit < 2 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}
