/** Numbers as the widgets write them, in English: `1,234`, `700 MB`. */
export class Units {
  /** The byte units, one per power of 1024. */
  private static readonly ByteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

  private static readonly Integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

  /** A whole number, its thousands grouped. */
  static integer(value: number) {
    return Units.Integer.format(value);
  }

  /** Bytes in the unit that keeps the number readable (`700 MB`, not `0.7 GB`), with one decimal from MB up. */
  static bytes(bytes: number) {
    const magnitude = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
    const unit = Math.min(magnitude, Units.ByteUnits.length - 1);
    const decimals = unit < 2 ? 0 : 1;
    const amount = new Intl.NumberFormat("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

    return `${amount.format(bytes / 1024 ** unit)} ${Units.ByteUnits[unit]}`;
  }

  /** `count` of a thing, in its singular or plural: `1 repo`, `3 repos`. */
  static count(count: number, one: string, other: string) {
    return `${Units.integer(count)} ${count === 1 ? one : other}`;
  }
}
