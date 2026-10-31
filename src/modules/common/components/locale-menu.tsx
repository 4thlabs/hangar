"use client";

import { LanguagesIcon } from "lucide-react";
import { Locale } from "#libs/preferences";
import { useLocaleSwitch } from "#modules/common/hooks/use-locale-switch.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** The user menu's language picker: a switch at hand, without a trip to the settings. */
export function LocaleMenu() {
  const { t } = useTranslation(CommonMessages);
  const { locale, switchLocale, isSwitching } = useLocaleSwitch();

  function handleValueChange(value: unknown) {
    if (typeof value !== "string" || !Locale.isLocale(value)) {
      return;
    }

    switchLocale(value);
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {isSwitching ? <Spinner /> : <LanguagesIcon />}
        <span>{t("navbar.language")}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-36">
        <DropdownMenuRadioGroup value={locale} onValueChange={handleValueChange}>
          {Locale.Locales.map(option => (
            <DropdownMenuRadioItem key={option.value} value={option.value} lang={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
