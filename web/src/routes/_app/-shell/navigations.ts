import { commonMessages } from "#modules/common/messages.ts";

export type NavigationPath = "/" | "/apps" | "/cluster" | "/store" | "/settings";

const words = commonMessages.shell.navigation;

type NavigationItem = {
  label: string;
  href: NavigationPath;
};

type NavigationCategory = {
  label: string;
  position?: "bottom";
  items: readonly NavigationItem[];
};

/** The sections of the app, in the order the navbar and the phone's tab bar list them. */
export const navigationCategories: readonly NavigationCategory[] = [
  {
    label: words.general,
    items: [
      { label: words.dashboard, href: "/" },
      { label: words.apps, href: "/apps" },
      { label: words.cluster, href: "/cluster" },
      { label: words.store, href: "/store" },
    ],
  },
  {
    label: words.administration,
    position: "bottom",
    items: [{ label: words.settings, href: "/settings" }],
  },
];

/**
 * Whether `href` is the section the router is currently in.
 * A prefix match, so `/apps/alpha` keeps Apps active; `/` is exact, or it would match everything.
 */
export function isNavigationActive(path: string, href: NavigationPath) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
