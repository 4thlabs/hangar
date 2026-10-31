"use client";

import { useAtom } from "jotai";
import { ChevronDownIcon } from "lucide-react";
import { Locale, Theme } from "#libs/preferences";
import { colorModeAtom, themePaletteAtom } from "#modules/common/atoms/theme.ts";
import { useLocaleSwitch } from "#modules/common/hooks/use-locale-switch.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";

type PreferenceFieldProps<T extends string> = {
  id: string;
  label: string;
  description: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: unknown) => void;
};

function PreferenceField<T extends string>({
  id,
  label,
  description,
  value,
  options,
  onValueChange,
}: PreferenceFieldProps<T>) {
  const valueLabel = options.find(option => option.value === value)?.label ?? value;

  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldLabel id={`${id}-label`} htmlFor={id}>
          {label}
        </FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button id={id} variant="outline" className="min-w-40 justify-between" />}>
          {valueLabel}
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
            {options.map(option => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

/** The look of the site and its language: remembered in cookies, applied at once. */
export function AppearanceSettingsCard() {
  const { t } = useTranslation(SettingsMessages);
  const [palette, setPalette] = useAtom(themePaletteAtom);
  const [mode, setMode] = useAtom(colorModeAtom);
  const { locale, switchLocale } = useLocaleSwitch();
  const modes = Theme.ColorModes.map(value => ({ value, label: t(`appearance.modes.${value}`) }));

  function handlePaletteChange(value: unknown) {
    if (typeof value !== "string" || !Theme.isPalette(value)) {
      return;
    }

    setPalette(value);
  }

  function handleModeChange(value: unknown) {
    if (typeof value !== "string" || !Theme.isColorMode(value)) {
      return;
    }

    setMode(value);
  }

  function handleLocaleChange(value: unknown) {
    if (typeof value !== "string" || !Locale.isLocale(value)) {
      return;
    }

    switchLocale(value);
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{t("appearance.title")}</CardTitle>
        <CardDescription>{t("appearance.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <PreferenceField
            id="theme-palette"
            label={t("appearance.palette")}
            description={t("appearance.paletteDescription")}
            value={palette}
            options={Theme.Palettes}
            onValueChange={handlePaletteChange}
          />
          <PreferenceField
            id="color-mode"
            label={t("appearance.mode")}
            description={t("appearance.modeDescription")}
            value={mode}
            options={modes}
            onValueChange={handleModeChange}
          />
          <PreferenceField
            id="locale"
            label={t("appearance.language")}
            description={t("appearance.languageDescription")}
            value={locale}
            options={Locale.Locales}
            onValueChange={handleLocaleChange}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
