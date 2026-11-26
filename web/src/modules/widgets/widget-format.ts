// Numbers as the widgets write them, in English: `1,234`, `700 MB`.

/** The byte units, one per power of 1024. */
const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

const integerFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** A whole number, its thousands grouped. */
export function formatInteger(value: number) {
  return integerFormat.format(value);
}

/** Bytes in the unit that keeps the number readable (`700 MB`, not `0.7 GB`), with one decimal from MB up. */
export function formatBytes(bytes: number) {
  const magnitude = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  const unit = Math.min(magnitude, byteUnits.length - 1);
  const decimals = unit < 2 ? 0 : 1;
  const amount = new Intl.NumberFormat("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return `${amount.format(bytes / 1024 ** unit)} ${byteUnits[unit]}`;
}

/** `count` of a thing, in its singular or plural: `1 repo`, `3 repos`. */
export function formatCount(count: number, one: string, other: string) {
  return `${formatInteger(count)} ${count === 1 ? one : other}`;
}
