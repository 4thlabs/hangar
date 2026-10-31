import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { ArcaneMessages } from "./messages.ts";

/** Containers, images and volumes as Arcane reports them. */
export const arcaneGeneralStatsDescriptor = describeWidget({
  schema: WidgetSchema.service("arcane-general-stats"),
  app: "arcane",
  appearance: {
    messages: ArcaneMessages,
    icon: WidgetIcon.dashboard("arcane"),
    className: "@container min-h-64",
  },
  module: () => import("./general-stats.tsx"),
  create: ({ arcaneGeneralStats }, _config, service) => arcaneGeneralStats(service()),
});
