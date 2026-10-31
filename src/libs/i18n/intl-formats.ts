import { Locale, type LocaleCode } from "#libs/preferences";

/**
 * The `Intl` formatters of each language, built once per language and options and kept: building one is not free, and
 * a page formats dozens of numbers and dates, a clock one every second.
 */
export class IntlFormats {
  private static readonly Built = new Map<string, unknown>();

  /** Numbers, amounts and percentages, as `locale` writes them. */
  static number(locale: LocaleCode, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
    return IntlFormats.get("number", locale, options, tag => new Intl.NumberFormat(tag, options));
  }

  /** Dates and times, as `locale` writes them. */
  static dateTime(locale: LocaleCode, options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
    return IntlFormats.get("dateTime", locale, options, tag => new Intl.DateTimeFormat(tag, options));
  }

  /** "2 minutes ago", as `locale` says it. */
  static relativeTime(locale: LocaleCode, options: Intl.RelativeTimeFormatOptions = {}): Intl.RelativeTimeFormat {
    return IntlFormats.get("relativeTime", locale, options, tag => new Intl.RelativeTimeFormat(tag, options));
  }

  /** Which plural form a count takes in `locale`. */
  static pluralRules(locale: LocaleCode): Intl.PluralRules {
    return IntlFormats.get("pluralRules", locale, {}, tag => new Intl.PluralRules(tag));
  }

  private static get<Format>(
    kind: string,
    locale: LocaleCode,
    options: object,
    build: (tag: string) => Format,
  ): Format {
    const key = `${kind}:${locale}:${JSON.stringify(options)}`;
    let format = IntlFormats.Built.get(key) as Format | undefined;

    if (!format) {
      format = build(Locale.intlTag(locale));
      IntlFormats.Built.set(key, format);
    }

    return format;
  }
}
