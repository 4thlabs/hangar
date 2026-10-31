import { IntlFormats } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";

/** Display formatting for container metrics, in the reader's language: `1.5 MiB`, `1,5 MiB`. */
export class MetricFormat {
  /** Binary units: the divisor is 1024, so these are KiB/MiB/GiB, not KB/MB/GB. */
  private static readonly ByteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

  /** A share to one decimal, always written: `12.0%`, not `12%`. */
  private static readonly Percent: Intl.NumberFormatOptions = {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  };

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
    const amount = IntlFormats.number(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** unit);

    return `${amount} ${MetricFormat.ByteUnits[unit]}`;
  }

  /**
   * A share out of 100, to one decimal; a dash for no reading.
   */
  static percent(value: number | null, locale: LocaleCode) {
    if (value === null) {
      return "—";
    }

    return IntlFormats.number(locale, MetricFormat.Percent).format(value / 100);
  }
}
