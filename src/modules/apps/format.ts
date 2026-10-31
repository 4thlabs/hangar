import { Locale, type LocaleCode } from "#libs/preferences";

/** Display formatting for container metrics, in the reader's language: `1.5 MiB`, `1,5 MiB`. */
export class MetricFormat {
  /** Binary units: the divisor is 1024, so these are KiB/MiB/GiB, not KB/MB/GB. */
  private static readonly ByteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

  /** One formatter per language and kind, built on first use. */
  private static readonly Formatters = new Map<string, Intl.NumberFormat>();

  /**
   * A size in bytes, in the largest unit under 1024 of it; a dash for no reading.
   */
  static bytes(value: number | null, locale: LocaleCode) {
    if (value === null) {
      return "—";
    }

    if (value === 0) {
      return "0 B";
    }

    const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), MetricFormat.ByteUnits.length - 1);
    const amount = MetricFormat.formatter(locale, "decimal").format(value / 1024 ** unit);

    return `${amount} ${MetricFormat.ByteUnits[unit]}`;
  }

  /**
   * A share out of 100, to one decimal; a dash for no reading.
   */
  static percent(value: number | null, locale: LocaleCode) {
    return value === null ? "—" : MetricFormat.formatter(locale, "percent").format(value / 100);
  }

  private static formatter(locale: LocaleCode, kind: "decimal" | "percent") {
    const key = `${locale}:${kind}`;
    let formatter = MetricFormat.Formatters.get(key);

    if (!formatter) {
      const digits = kind === "percent" ? { minimumFractionDigits: 1 } : {};

      formatter = new Intl.NumberFormat(Locale.intlTag(locale), {
        style: kind,
        maximumFractionDigits: 1,
        ...digits,
      });

      MetricFormat.Formatters.set(key, formatter);
    }

    return formatter;
  }
}
