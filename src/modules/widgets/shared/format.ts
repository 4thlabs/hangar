import { Locale, type LocaleCode } from "#libs/preferences";

/** Numbers as the widget metrics render them, in the reader's language: `1,234` or `1 234`. */
export class Units {
  /** The byte units, one per power of 1024. */
  private static readonly ByteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

  /** One formatter per language and number of decimals, built on first use. */
  private static readonly Formatters = new Map<string, Intl.NumberFormat>();

  /** A whole number, grouped the way the reader's language groups thousands. */
  static integer(value: number, locale: LocaleCode) {
    return Units.formatter(locale, 0).format(value);
  }

  /** Bytes in whichever unit keeps the number readable (`700 MB`, not `0.7 GB`); one decimal from MB up. */
  static bytes(bytes: number, locale: LocaleCode) {
    const magnitude = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
    const unit = Math.min(magnitude, Units.ByteUnits.length - 1);
    const value = bytes / 1024 ** unit;

    return `${Units.formatter(locale, unit < 2 ? 0 : 1).format(value)} ${Units.ByteUnits[unit]}`;
  }

  private static formatter(locale: LocaleCode, decimals: number) {
    const key = `${locale}:${decimals}`;
    let formatter = Units.Formatters.get(key);

    if (!formatter) {
      formatter = new Intl.NumberFormat(Locale.intlTag(locale), {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

      Units.Formatters.set(key, formatter);
    }

    return formatter;
  }
}
