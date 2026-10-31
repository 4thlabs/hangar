"use client";

import { useEffect, useState } from "react";
import { useLocale } from "#modules/common/hooks/use-translation.ts";
import { SpotlightSources } from "#modules/spotlight/sources.ts";
import type { SpotlightItem } from "#modules/spotlight/spotlight.ts";

/** What a source returned at its last load; absent until its first one ends. */
export type SpotlightSourceResult = { status: "ready"; items: SpotlightItem[] } | { status: "failed" };

/**
 * The results of the sources in scope, or of all of them without one, reloaded at each opening and each change of
 * scope, and in the new language when the reader switches. Each source lands on its own, so a slow one does not hold the others back, and a failed one does not hide
 * them. The previous results stay on screen while the next arrive.
 */
export function useSpotlightResults(open: boolean, scopeId: string | null): ReadonlyMap<string, SpotlightSourceResult> {
  const locale = useLocale();
  const [results, setResults] = useState<ReadonlyMap<string, SpotlightSourceResult>>(() => new Map());

  useEffect(() => {
    if (!open) {
      return;
    }

    let isCurrent = true;

    function settle(id: string, result: SpotlightSourceResult) {
      if (isCurrent) {
        setResults(current => new Map(current).set(id, result));
      }
    }

    const scope = SpotlightSources.find(scopeId);

    for (const source of scope ? [scope] : SpotlightSources.All) {
      source.load(locale).then(
        items => settle(source.id, { status: "ready", items }),
        (error: unknown) => {
          console.error(`Spotlight source "${source.id}" failed to load`, error);
          settle(source.id, { status: "failed" });
        },
      );
    }

    return () => {
      isCurrent = false;
    };
  }, [open, scopeId, locale]);

  return results;
}
