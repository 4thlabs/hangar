import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { BeszelMessages } from "./messages.ts";

/** Per-host CPU, memory and disk, as the Beszel hub last heard them. */
export const beszelServerStatsDescriptor = describeWidget({
  schema: WidgetSchema.service("beszel-server-stats"),
  app: "beszel",
  appearance: {
    messages: BeszelMessages,
    icon: WidgetIcon.dashboard("beszel", "beszel-light"),
    className: "min-h-40",
  },
  module: () => import("./server-stats.tsx"),
  create: ({ beszelServerStats }, _config, service) => beszelServerStats(service()),
});
