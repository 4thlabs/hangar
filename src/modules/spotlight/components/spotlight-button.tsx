"use client";

import { useSetAtom } from "jotai";
import { TextSearchIcon } from "lucide-react";
import { Button } from "#modules/common/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#modules/common/ui/tooltip.tsx";
import { spotlightAtom } from "#modules/spotlight/atoms/spotlight.ts";
import { useSpotlightPlatform } from "#modules/spotlight/hooks/use-spotlight-platform.ts";
import { Spotlight } from "#modules/spotlight/spotlight.ts";

/**
 * Opens the palette on every source: the way in where there is no keyboard. Its own icon, so it does not pass
 * for the page search's magnifier next to it on phones.
 */
export function SpotlightButton() {
  const setSpotlight = useSetAtom(spotlightAtom);
  const platform = useSpotlightPlatform();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Rechercher partout"
            onClick={() => setSpotlight({ open: true, scope: null })}
          />
        }
      >
        <TextSearchIcon />
      </TooltipTrigger>
      <TooltipContent>Rechercher partout ({Spotlight.label(Spotlight.Shortcut, platform)})</TooltipContent>
    </Tooltip>
  );
}
