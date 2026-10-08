import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";

/** Containers, images and volumes as Arcane reports them. */
export const arcaneGeneralStatsDescriptor = describeWidget({
  schema: WidgetSchema.service("arcane-general-stats"),
  app: "arcane",
  appearance: {
    title: "Arcane",
    icon: WidgetIcon.dashboard("arcane"),
    className: "@container min-h-64",
    errorDescription: "The general statistics could not be loaded.",
  },
  module: () => import("./general-stats.tsx"),
  create: ({ arcaneGeneralStats }, _config, service) => arcaneGeneralStats(service()),
});
