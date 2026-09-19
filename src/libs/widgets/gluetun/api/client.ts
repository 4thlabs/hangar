import type { WidgetService } from "../../config/config.ts";
import { serviceClient } from "../../shared/service-client.ts";

/**
 * What gluetun reports about the address it is exiting from.
 *
 * Snake case as the control server sends it. An empty `public_ip` is gluetun's way of saying the
 * tunnel is down — it answers 200 either way, so a failed request means the control server itself
 * is unreachable, not that the VPN dropped.
 */
export interface GluetunPublicIp {
  public_ip: string;
  city: string;
  country: string;
}

/** Talks to one gluetun control server, which versions its API under `/v1` rather than `/api`. */
export async function createGluetunClient(service: WidgetService) {
  const client = await serviceClient(service, { prefix: "/v1" });

  return {
    /** Gets the public address the tunnel currently exits from. */
    getPublicIp: () => client.get<GluetunPublicIp>("publicip/ip").json(),
  };
}
