import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import type { LocaleCode } from "#libs/preferences";
import { localeAtom } from "#modules/common/atoms/locale.ts";

/** Renders `children` as a reader of `locale` would see them, for a test about one language. */
export function LocaleProvider({ locale, children }: { locale: LocaleCode; children: ReactNode }) {
  const store = createStore();

  store.set(localeAtom, locale);

  return <Provider store={store}>{children}</Provider>;
}
