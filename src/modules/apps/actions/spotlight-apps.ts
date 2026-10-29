"use server";

import { sessions } from "#libs/auth/server";
import { env } from "#libs/env";
import type { HangarApp } from "#libs/hangar";
import { AppLink } from "#libs/hangar/link";
import { hangar } from "#libs/hangar/server";
import type { SpotlightAction, SpotlightItem } from "#modules/spotlight/spotlight.ts";

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
   * Opening the app first, since that is what a search for it is usually for, then its page. An app Traefik does not
   * serve (a database, a VPN sidecar) has nothing to open: its page comes first, and alone.
   */
  static create(app: HangarApp): [SpotlightAction, ...SpotlightAction[]] {
    const page: SpotlightAction = { kind: "navigate", label: "Voir la page", to: `/apps/${app.id}` };

    if (!app.routed) {
      return [page];
    }

    return [{ kind: "open", label: "Ouvrir", url: AppLink.url(app.containerName, env.DOMAIN) }, page];
  }
}
