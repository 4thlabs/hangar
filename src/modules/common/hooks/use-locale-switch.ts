"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useTransition } from "react";
import { useRouter } from "waku";
import { Locale, type LocaleCode } from "#libs/preferences";
import { localeAtom } from "#modules/common/atoms/locale.ts";
import { PreferenceCookie } from "#modules/common/preference-cookie.ts";

/**
 * The language the user picked, and how to pick another: client components follow at once, server
 * components once the route has re-rendered with the new cookie.
 */
export function useLocaleSwitch() {
  const router = useRouter();
  const locale = useAtomValue(localeAtom);
  const setLocale = useSetAtom(localeAtom);
  const [isSwitching, startTransition] = useTransition();

  function switchLocale(next: LocaleCode) {
    if (next === locale) {
      return;
    }

    // Written before the reload: the server reads the language from this cookie.
    PreferenceCookie.write(Locale.Cookie, next);
    setLocale(next);
    document.documentElement.lang = next;
    startTransition(() => router.reload());
  }

  return { locale, switchLocale, isSwitching };
}
