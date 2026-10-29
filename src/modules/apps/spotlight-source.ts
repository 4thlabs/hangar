import { spotlightApps } from "#modules/apps/actions/spotlight-apps.ts";
import type { SpotlightSource } from "#modules/spotlight/spotlight.ts";

/** The installed apps, to open in a new tab or to look at in Hangar. */
export class AppsSpotlightSource {
  static readonly Source: SpotlightSource = {
    id: "apps",
    label: "Apps",
    prefix: "@",
    shortcut: { key: "a", alt: true },
    load: spotlightApps,
  };
}
