import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";

/** Per-repository backup health. Needs an explicit `link:`: the store's Traefik router for Backrest is `backup`. */
export const backrestSummaryDescriptor = describeWidget({
  schema: WidgetSchema.service("backrest-summary"),
  app: "backrest",
  appearance: {
    title: "Backrest",
    icon: WidgetIcon.dashboard("backrest"),
    className: "min-h-40",
    errorDescription: "The backup status could not be loaded.",
  },
  module: () => import("./summary.tsx"),
  create: ({ backrestSummary }, _config, service) => backrestSummary(service()),
});
