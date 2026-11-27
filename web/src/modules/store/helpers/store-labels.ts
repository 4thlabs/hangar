import type { AppFilter } from "#libs/api";
import { m } from "#paraglide/messages.js";

/** The words of each value `store` shows a label of, by the type that lists them: a new value is a type error here. */
export const storeLabels = {
  /** What each filter is called in the menu. */
  filter: {
    installed: m.store_filter_installed,
    available: m.store_filter_available,
  } satisfies Record<AppFilter, () => string>,
};
