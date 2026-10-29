import { SettingsIcon, UserCogIcon } from "lucide-react";
import { navigations } from "#modules/common/navigations.ts";
import { SettingsTab } from "#modules/settings/settings-tab.ts";
import type { SpotlightAction, SpotlightItem, SpotlightSource } from "#modules/spotlight/spotlight.ts";

/** Hangar's own pages: the navigation bar's, each settings tab, and the user's settings. Known in the browser, nothing to fetch. */
export class PagesSpotlightSource {
  private static readonly GoLabel = "Aller à la page";

  static readonly Source: SpotlightSource = {
    id: "pages",
    label: "Pages",
    prefix: "/",
    shortcut: { key: "p", alt: true },
    load: async () => [
      ...navigations
        .flatMap(category => category.items)
        .map(item => PagesSpotlightSource.item(item.href, item.label, item.icon)),
      ...SettingsTab.All.map(tab =>
        PagesSpotlightSource.item(SettingsTab.href(tab.id), `Paramètres › ${tab.label}`, SettingsIcon),
      ),
      PagesSpotlightSource.item("/user/settings", "Paramètres utilisateur", UserCogIcon),
    ],
  };

  private static item(to: string, label: string, icon: SpotlightItem["icon"]): SpotlightItem {
    const go: SpotlightAction = { kind: "navigate", label: PagesSpotlightSource.GoLabel, to };

    return { id: to, label, icon, actions: [go] };
  }
}
