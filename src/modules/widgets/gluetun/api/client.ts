import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/**
 * What gluetun reports about the address it exits from, snake case as sent. A failed request means the control server
 * is unreachable, not that the VPN dropped.
 */
export interface GluetunPublicIp {
  public_ip: string;
  city: string;
  country: string;
}

/** Talks to one gluetun control server, which versions its API under `/v1` rather than `/api`. */
export class GluetunClient extends ServiceClient {
  static async connect(service: WidgetService) {
    return new GluetunClient(await ServiceClient.client(service, { prefix: "/v1" }));
  }

  getPublicIp() {
    return this.http.get<GluetunPublicIp>("publicip/ip").json();
  }
}
