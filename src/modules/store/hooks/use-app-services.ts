"use client";

import { useEffect, useState } from "react";
import type { ProjectServices } from "#modules/apps/project-services.ts";
import { readAppServices } from "#modules/store/actions/read-app-services.ts";

/** How often the editor reads the app's services again, in milliseconds. */
class AppServicesRefresh {
  /** Soon enough to follow an Up or a Down run from the page; the daemon's reads are cached until it changes. */
  static readonly Interval = 5_000;

  /** While Docker does not answer: as often as the apps page retries, so a dead daemon is not logged every 5 s. */
  static readonly UnavailableInterval = 30_000;
}

/**
 * An app's services, read on arrival then again every few seconds, without reloading the page and its drafts.
 * `null` until the first answer. Skipped while the tab is hidden, so it does not keep asking the daemon for nobody.
 */
export function useAppServices(id: string): ProjectServices | null {
  const [services, setServices] = useState<ProjectServices | null>(null);

  useEffect(() => {
    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      let next: ProjectServices | null = null;

      if (!document.hidden) {
        try {
          next = await readAppServices(id);
        } catch (error) {
          console.error("Could not read the app's services", { error, app: id });
        }
      }

      if (!isMounted) {
        return;
      }

      if (next) {
        setServices(next);
      }

      const isAnswering = next === null || next.state !== "unavailable";

      timer = setTimeout(
        () => void refresh(),
        isAnswering ? AppServicesRefresh.Interval : AppServicesRefresh.UnavailableInterval,
      );
    }

    void refresh();

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [id]);

  return services;
}
