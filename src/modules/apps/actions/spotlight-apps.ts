"use server";

import { sessions } from "#libs/auth/server";
import { env } from "#libs/env";
import type { HangarApp } from "#libs/hangar";
import { AppLink } from "#libs/hangar/link";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { AppsMessages } from "#modules/apps/messages.ts";
import type { SpotlightAction, SpotlightItem, SpotlightItemActions } from "#modules/spotlight/spotlight.ts";

/**
 * The installed apps, as the palette lists them. Read from the store alone, so the palette opens even when Docker
 * is down.
 */
export const spotlightApps = async (): Promise<SpotlightItem[]> => {
  await sessions.require();

  return hangar.store
    .installedApps()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(app => ({
      id: app.id,
      label: app.name,
      keywords: [app.id],
      icon: app.icon,
      actions: SpotlightAppActions.create(app),
    }));
};

/** What picking an app does. */
class SpotlightAppActions {
  /**
   * Opening the app first, since that is what a search for it is usually for, then its page, and its editor on
   * Ctrl/⌘+Shift. An app Traefik does not serve (a database, a VPN sidecar) has nothing to open: Enter goes to its
   * page.
   */
  static create(app: HangarApp): SpotlightItemActions {
    const { t } = ServerTranslation.get(AppsMessages);
    const page: SpotlightAction = { kind: "navigate", label: t("spotlight.viewPage"), to: `/apps/${app.id}` };
    const edit: SpotlightAction = { kind: "navigate", label: t("spotlight.edit"), to: `/store/${app.id}/edit` };

    if (!app.routed) {
      return { enter: page, modShift: edit };
    }

    const open: SpotlightAction = {
      kind: "open",
      label: t("spotlight.open"),
      url: AppLink.url(app.containerName, env.DOMAIN),
    };

    return { enter: open, mod: page, modShift: edit };
  }
}
