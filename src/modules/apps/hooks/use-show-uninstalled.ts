import { useState } from "react";
import { UninstalledApps } from "#libs/preferences";
import { PreferenceCookie } from "#modules/common/preference-cookie.ts";

/**
 * Whether the store apps that are not installed are listed, and how to change it. The rows are already there,
 * so a change only filters on screen; the cookie keeps it for the next visit, on Apps and Cluster alike.
 * @param initial The choice the server rendered with, read from the cookie
 */
export function useShowUninstalled(initial: boolean) {
  const [shown, setShown] = useState(initial);

  const change = (next: boolean) => {
    setShown(next);
    PreferenceCookie.write(UninstalledApps.Cookie, UninstalledApps.serialize(next));
  };

  return [shown, change] as const;
}
