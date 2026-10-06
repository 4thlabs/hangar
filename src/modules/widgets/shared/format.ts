/** Numbers as the widget metrics render them. */
export class Units {
  static readonly Integer = new Intl.NumberFormat("en-US");

  /** The byte units, one per power of 1024. */
  private static readonly ByteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

  /** Bytes in whichever unit keeps the number readable (`700 MB`, not `0.7 GB`); one decimal from MB up. */
  static bytes(bytes: number) {
    const magnitude = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
    const unit = Math.min(magnitude, Units.ByteUnits.length - 1);
    const value = bytes / 1024 ** unit;

    return `${value.toFixed(unit < 2 ? 0 : 1)} ${Units.ByteUnits[unit]}`;
  }
}
