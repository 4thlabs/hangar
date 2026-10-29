"use client";

import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { spotlightAtom } from "#modules/spotlight/atoms/spotlight.ts";
import { SpotlightSources } from "#modules/spotlight/sources.ts";
import { Spotlight, type SpotlightKeyboardLayout } from "#modules/spotlight/spotlight.ts";

/** Opens the palette on its own shortcut, or narrowed to a source on that source's. One listener for all of them. */
export function useSpotlightShortcuts() {
  const setSpotlight = useSetAtom(spotlightAtom);

  useEffect(() => {
    const platform = Spotlight.platform(navigator.userAgent);
    let layout: SpotlightKeyboardLayout | null = null;

    // Read again whenever the window regains focus: the layout may have been switched meanwhile.
    function readLayout() {
      Spotlight.layout(navigator).then(
        current => {
          layout = current;
        },
        (error: unknown) => console.error("Could not read the keyboard layout", error),
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (Spotlight.matches(Spotlight.Shortcut, event, platform, layout)) {
        event.preventDefault();
        setSpotlight({ open: true, scope: null });

        return;
      }

      const isTyping = Spotlight.isTextField(event.target);

      const source = SpotlightSources.All.find(
        candidate =>
          Spotlight.matches(candidate.shortcut, event, platform, layout) &&
          !(isTyping && Spotlight.typesText(candidate.shortcut, platform)),
      );

      if (source) {
        event.preventDefault();
        setSpotlight({ open: true, scope: source.id });
      }
    }

    readLayout();
    window.addEventListener("focus", readLayout);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("focus", readLayout);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [setSpotlight]);
}
