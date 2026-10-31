import { SettingsIcon, UserCogIcon } from "lucide-react";
import type { Unstable_RouteHref } from "waku/router/client";
import { Translation, type Translate } from "#libs/i18n";
import { CommonMessages } from "#modules/common/messages.ts";
import { navigations } from "#modules/common/navigations.ts";
import { SettingsMessages } from "#modules/settings/messages.ts";
import { SettingsTab } from "#modules/settings/settings-tab.ts";
import type { SpotlightAction, SpotlightItem, SpotlightSource } from "#modules/spotlight/spotlight.ts";

/** Hangar's own pages: the navigation bar's, each settings tab, and the user's settings. Known in the browser, nothing to fetch. */
export class PagesSpotlightSource {
  static readonly Source: SpotlightSource = {
    id: "pages",
    label: locale => Translation.create(CommonMessages, locale)("pages.label"),
    prefix: "/",
    shortcut: { key: "p", alt: true },
    load: async locale =>
      PagesSpotlightSource.items(
        Translation.create(CommonMessages, locale),
        Translation.create(SettingsMessages, locale),
      ),
  };

  private static items(
    t: Translate<typeof CommonMessages.en>,
    settings: Translate<typeof SettingsMessages.en>,
  ): SpotlightItem[] {
    const go = t("pages.go");

    return [
      ...navigations
        .flatMap(category => category.items)
        .map(item => PagesSpotlightSource.item(item.href, t(`navigation.${item.label}`), item.icon, go)),
      ...SettingsTab.All.map(tab =>
        PagesSpotlightSource.item(
          SettingsTab.href(tab.id),
          t("pages.settingsTab", { tab: settings(`tabs.${tab.id}`) }),
          SettingsIcon,
          go,
        ),
      ),
      PagesSpotlightSource.item("/user/settings", t("pages.userSettings"), UserCogIcon, go),
    ];
  }

  private static item(
    to: Unstable_RouteHref,
    label: string,
    icon: SpotlightItem["icon"],
    goLabel: string,
  ): SpotlightItem {
    const go: SpotlightAction = { kind: "navigate", label: goLabel, to };

    return { id: to, label, icon, actions: { enter: go } };
  }
}
