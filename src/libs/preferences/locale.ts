/** A language the interface is written in. */
export type LocaleCode = (typeof Locale.Locales)[number]["value"];

/**
 * The language a user picks, remembered in a cookie beside the theme's so the server renders the
 * right one on the first paint.
 */
export class Locale {
  /** Every language, each labelled in itself: a reader lost in the other one still finds theirs. */
  static readonly Locales = [
    { value: "en", label: "English" },
    { value: "fr", label: "Français" },
  ] as const;

  /** The language of a user who never picked one. */
  static readonly Default: LocaleCode = "en";

  /** The cookie holding the language. */
  static readonly Cookie = "locale";

  /** The BCP 47 tag `Intl` formats each language with. */
  private static readonly IntlTags: Readonly<Record<LocaleCode, string>> = {
    en: "en-US",
    fr: "fr-FR",
  };

  /**
   * Whether `value` names one of the {@link Locale.Locales}.
   */
  static isLocale(value: string | undefined): value is LocaleCode {
    return Locale.Locales.some(option => option.value === value);
  }

  /**
   * The tag to hand `Intl` formatters for `locale`: numbers and dates follow the interface.
   */
  static intlTag(locale: LocaleCode) {
    return Locale.IntlTags[locale];
  }
}
