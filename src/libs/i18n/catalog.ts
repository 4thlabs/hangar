import type { LocaleCode } from "#libs/preferences";

/**
 * One module's messages in every language. A message is a string, or a function of its
 * parameters when it interpolates or pluralizes; each language has the shape of the others, so a
 * missing or stray key is a type error.
 *
 * A module declares one as the static members of a class, `en` first and `fr` typed after it:
 * `class AppsMessages { static readonly en = {…}; static readonly fr: typeof AppsMessages.en = {…} }`.
 */
export type Catalog<Messages> = Readonly<Record<LocaleCode, Messages>>;
