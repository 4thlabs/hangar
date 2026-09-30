import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

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
export class GluetunClient extends ServiceClient {
  /**
   * Opens a client for the gluetun control server `service` points at.
   */
  static async connect(service: WidgetService) {
    return new GluetunClient(await ServiceClient.client(service, { prefix: "/v1" }));
  }

  /**
   * Gets the public address the tunnel currently exits from.
   */
  getPublicIp() {
    return this.http.get<GluetunPublicIp>("publicip/ip").json();
  }
}
