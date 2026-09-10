"use client";

import { useAtom } from "jotai";
import { ChevronDownIcon } from "lucide-react";
import { colorModeAtom, themePaletteAtom } from "#app/atoms/theme.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#app/components/ui/dropdown-menu.tsx";

import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { COLOR_MODES, isColorMode, isThemePalette, THEME_PALETTES } from "#libs/preferences/shared";

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

  const paletteLabel = THEME_PALETTES.find(option => option.value === palette)?.label ?? palette;
  const modeLabel = COLOR_MODES.find(option => option.value === mode)?.label ?? mode;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Apparence</CardTitle>
        <CardDescription>Personnalisez les couleurs du site et leur adaptation à votre système.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel id="theme-palette-label" htmlFor="theme-palette">
                Palette
              </FieldLabel>
              <FieldDescription>Choisissez l’identité visuelle utilisée sur le site.</FieldDescription>
            </FieldContent>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button id="theme-palette" variant="outline" className="min-w-40 justify-between" />}
              >
                {paletteLabel}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuRadioGroup value={palette} onValueChange={handlePaletteChange}>
                  {THEME_PALETTES.map(option => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel id="color-mode-label" htmlFor="color-mode">
                Mode
              </FieldLabel>
              <FieldDescription>Utilisez un affichage clair, sombre ou celui de votre système.</FieldDescription>
            </FieldContent>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button id="color-mode" variant="outline" className="min-w-40 justify-between" />}
              >
                {modeLabel}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuRadioGroup value={mode} onValueChange={handleModeChange}>
                  {COLOR_MODES.map(option => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
