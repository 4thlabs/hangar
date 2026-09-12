"use client";

import { useAtom } from "jotai";
import { ChevronDownIcon } from "lucide-react";
import { colorModeAtom, themePaletteAtom } from "#app/atoms/theme.ts";
import { Card } from "#app/components/card/accent-card.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#app/components/ui/dropdown-menu.tsx";

import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { COLOR_MODES, isColorMode, isThemePalette, THEME_PALETTES } from "#libs/preferences/shared";

type ThemePreferenceFieldProps<T extends string> = {
  id: string;
  label: string;
  description: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: unknown) => void;
};

function ThemePreferenceField<T extends string>({
  id,
  label,
  description,
  value,
  options,
  onValueChange,
}: ThemePreferenceFieldProps<T>) {
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

export function ThemeSettingsCard() {
  const [palette, setPalette] = useAtom(themePaletteAtom);
  const [mode, setMode] = useAtom(colorModeAtom);

  function handlePaletteChange(value: unknown) {
    if (typeof value !== "string" || !isThemePalette(value)) return;

    setPalette(value);
  }

  function handleModeChange(value: unknown) {
    if (typeof value !== "string" || !isColorMode(value)) return;

    setMode(value);
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>APPARENCE</CardTitle>
        <CardDescription>Personnalisez les couleurs du site et leur adaptation à votre système.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <ThemePreferenceField
            id="theme-palette"
            label="Palette"
            description="Choisissez l’identité visuelle utilisée sur le site."
            value={palette}
            options={THEME_PALETTES}
            onValueChange={handlePaletteChange}
          />
          <ThemePreferenceField
            id="color-mode"
            label="Mode"
            description="Utilisez un affichage clair, sombre ou celui de votre système."
            value={mode}
            options={COLOR_MODES}
            onValueChange={handleModeChange}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
