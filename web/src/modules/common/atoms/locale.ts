import { atom } from "jotai";
import { Locale, type LocaleCode } from "#libs/preferences";

export const localeAtom = atom<LocaleCode>(Locale.Default);
