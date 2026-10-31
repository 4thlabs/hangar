import type { LocaleCode } from "#libs/preferences";
import { IntlFormats } from "./intl-formats.ts";

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
  /**
   * The form of `forms` that `count` takes in `locale`.
   */
  static select(locale: LocaleCode, count: number, forms: PluralForms) {
    return IntlFormats.pluralRules(locale).select(count) === "one" ? forms.one : forms.other;
  }
}
