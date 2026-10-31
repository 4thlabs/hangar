import "server-only";
import { userPreferences } from "#libs/preferences/server";
import type { Catalog } from "../catalog.ts";
import { Translation } from "../translation.ts";

/** The translation of the request in flight, for server components, actions and API routes. */
export class ServerTranslation {
  /**
   * The `t` of `catalog` in the language of the user whose request is being handled, with that language for what a
   * catalog does not cover: `Intl` formatters.
   */
  static get<Messages>(catalog: Catalog<Messages>) {
    const { locale } = userPreferences.get();

    return { t: Translation.create(catalog, locale), locale };
  }
}
