import { AppsSpotlightSource } from "#modules/apps/spotlight-source.ts";
import { PagesSpotlightSource } from "#modules/common/spotlight-source.ts";
import type { SpotlightSource } from "#modules/spotlight/spotlight.ts";

/** Every source the palette searches, in the order its groups show. A new source is one more line here. */
export class SpotlightSources {
  static readonly All: readonly SpotlightSource[] = [AppsSpotlightSource.Source, PagesSpotlightSource.Source];

  static find(id: string | null) {
    return SpotlightSources.All.find(source => source.id === id) ?? null;
  }
}
