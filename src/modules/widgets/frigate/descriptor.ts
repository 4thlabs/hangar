import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";

/** The latest camera events, with their thumbnails relayed through Hangar. */
export const frigateEventsDescriptor = describeWidget({
  schema: WidgetSchema.service("frigate-events"),
  app: "frigate",
  appearance: {
    title: "Frigate",
    icon: WidgetIcon.dashboard("frigate", "frigate-light"),
    className: "min-h-88",
    errorDescription: "The camera events could not be loaded.",
  },
  module: () => import("./events.tsx"),
  create: ({ frigateEvents }, _config, service) => frigateEvents(service()),
  relay: async (service, id) => {
    const { FrigateClient } = await import("./api/index.ts");

    return (await FrigateClient.connect(service)).getThumbnail(id);
  },
});
