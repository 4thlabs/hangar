import { Locale, type LocaleCode } from "#libs/preferences";

/** The two forms English and French tell apart. */
export type PluralForms = {
  one: string;
  other: string;
};

/**
 * Picks the form of a word a count calls for, by the language's own rule: French says
 * "0 application", English "0 applications".
 */
export class Plural {
  /** One rule set per language, built on first use. */
  private static readonly Rules = new Map<LocaleCode, Intl.PluralRules>();

  /**
   * The form of `forms` that `count` takes in `locale`.
   */
  static select(locale: LocaleCode, count: number, forms: PluralForms) {
    return Plural.rules(locale).select(count) === "one" ? forms.one : forms.other;
  }

  private static rules(locale: LocaleCode) {
    let rules = Plural.Rules.get(locale);

    if (!rules) {
      rules = new Intl.PluralRules(Locale.intlTag(locale));
      Plural.Rules.set(locale, rules);
    }

    return rules;
  }
}
