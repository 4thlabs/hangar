import * as z from "zod";
import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { JellyfinMessages } from "./messages.ts";

/** The library's totals and what landed in it last, with posters relayed through Hangar. */
export const jellyfinLatestDescriptor = describeWidget({
  schema: WidgetSchema.service("jellyfin-latest").extend({
    /** Jellyfin scopes "latest" to a user, so there is no server-wide answer to ask for. */
    user: z.string().min(1),
  }),
  app: "jellyfin",
  appearance: {
    messages: JellyfinMessages,
    icon: WidgetIcon.dashboard("jellyfin"),
    className: "min-h-64",
  },
  module: () => import("./latest.tsx"),
  create: ({ jellyfinLatest }, config, service) => jellyfinLatest(service(), config.user),
  relay: async (service, id) => {
    const { JellyfinClient } = await import("./api/index.ts");

    return (await JellyfinClient.connect(service)).getPoster(id);
  },
});
