import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";

/** The newest feed entries, and how many are unread. */
export const minifluxEntriesDescriptor = describeWidget({
  schema: WidgetSchema.service("miniflux-entries"),
  app: "miniflux",
  appearance: {
    title: "Miniflux",
    icon: WidgetIcon.dashboard("miniflux", "miniflux-light"),
    errorDescription: "The feed entries could not be loaded.",
  },
  module: () => import("./entries.tsx"),
  create: ({ minifluxEntries }, _config, service) => minifluxEntries(service()),
});
