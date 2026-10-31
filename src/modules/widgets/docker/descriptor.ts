import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { DockerWidgetMessages } from "./messages.ts";

/** Reads the Docker daemon Hangar already talks to: no service to declare, and no TTL, since it caches nothing. */
export const dockerGeneralStatsDescriptor = describeWidget({
  schema: WidgetSchema.local("docker-general-stats"),
  appearance: {
    messages: DockerWidgetMessages,
    icon: WidgetIcon.dashboard("docker"),
    className: "@container min-h-64",
  },
  module: () => import("./general-stats.tsx"),
  create: ({ dockerGeneralStats }) => dockerGeneralStats,
});
