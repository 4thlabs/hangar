"use client";

import { useInBrowser } from "#modules/common/hooks/use-in-browser.ts";
import { Spotlight, type SpotlightPlatform } from "#modules/spotlight/spotlight.ts";

/** The platform the shortcuts are read and spelled for; `other` until hydration, where there is no user agent. */
export function useSpotlightPlatform(): SpotlightPlatform {
  const inBrowser = useInBrowser();

  return inBrowser ? Spotlight.platform(navigator.userAgent) : "other";
}
