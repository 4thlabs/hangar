"use client";

import { useAtomValue } from "jotai";
import { Translation, type Catalog } from "#libs/i18n";
import { localeAtom } from "#modules/common/atoms/locale.ts";

/**
 * The `t` of `catalog` in the language the user picked, with that language for `Intl` formatters. Switching
 * language re-renders every caller at once, before the server components catch up.
 */
export function useTranslation<Messages>(catalog: Catalog<Messages>) {
  const locale = useAtomValue(localeAtom);

  return { t: Translation.create(catalog, locale), locale };
}

/** The language the user picked, for what a catalog does not cover: `Intl` formatters. */
export function useLocale() {
  return useAtomValue(localeAtom);
}
