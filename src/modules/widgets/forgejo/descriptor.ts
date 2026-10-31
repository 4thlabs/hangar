import * as z from "zod";
import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { ForgejoMessages } from "./messages.ts";

/** How many repositories Forgejo holds, what its Actions runners are busy with, and what was updated last. */
export const forgejoCiDescriptor = describeWidget({
  schema: WidgetSchema.service("forgejo-ci").extend({
    /** The users and organizations whose repositories the card covers; absent, every repository the key can see. */
    owners: z
      .array(z.string().regex(/^[\w.-]+$/, "must be a user or organization name"))
      .min(1)
      .optional(),
  }),
  app: "forgejo",
  appearance: {
    messages: ForgejoMessages,
    icon: WidgetIcon.dashboard("forgejo"),
    className: "min-h-40",
  },
  module: () => import("./ci.tsx"),
  create: ({ forgejoCi }, config, service) => forgejoCi(service(), config.owners),
});
