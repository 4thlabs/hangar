import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { GluetunMessages } from "./messages.ts";

/** Whether the VPN is up, and the public address it exits through. */
export const gluetunVpnStatusDescriptor = describeWidget({
  schema: WidgetSchema.service("gluetun-vpn-status"),
  app: "gluetun",
  appearance: {
    messages: GluetunMessages,
    icon: WidgetIcon.dashboard("gluetun"),
    className: "min-h-32",
  },
  module: () => import("./vpn-status.tsx"),
  create: ({ gluetunVpnStatus }, _config, service) => gluetunVpnStatus(service()),
});
