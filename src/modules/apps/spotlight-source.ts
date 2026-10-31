import { Translation } from "#libs/i18n";
import { spotlightApps } from "#modules/apps/actions/spotlight-apps.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import type { SpotlightSource } from "#modules/spotlight/spotlight.ts";

/** The installed apps, to open in a new tab or to look at in Hangar. */
export class AppsSpotlightSource {
  static readonly Source: SpotlightSource = {
    id: "apps",
    label: locale => Translation.create(AppsMessages, locale)("spotlight.label"),
    prefix: "@",
    shortcut: { key: "a", alt: true },
    // The action reads the language from its cookie, which the switch has already written.
    load: () => spotlightApps(),
  };
}
