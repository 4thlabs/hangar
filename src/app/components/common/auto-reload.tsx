"use client";

import { useEffect } from "react";
import { useRouter } from "waku";

/**
 * Re-renders the current route on an interval, so a page backed by live server data stays
 * current without a client-side fetch layer. Skipped while the tab is hidden: nobody is
 * looking, and the reload would keep hitting the Docker daemon for nothing.
 */
export function AutoReload({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void router.reload();
    }, seconds * 1_000);

    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
