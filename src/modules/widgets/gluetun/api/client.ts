import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/**
 * What gluetun reports about the address it exits from, in its snake case. A failed request means the control server
 * is unreachable, not that the VPN dropped. An empty address means the tunnel is down; an empty city or country, that
 * gluetun could not place it.
 */
export interface GluetunPublicIp {
  public_ip: string;
  city: string;
  country: string;
}

/** The reply as it comes: gluetun leaves out the fields it has no value for, and nothing checks the rest. */
type GluetunPublicIpReply = { [Field in keyof GluetunPublicIp]?: unknown } | null;

/** Talks to one gluetun control server, which versions its API under `/v1` rather than `/api`. */
export class GluetunClient extends ServiceClient {
  static async connect(service: WidgetService) {
    return new GluetunClient(await ServiceClient.client(service, { prefix: "/v1" }));
  }

  /** The exit address, every field filled: one gluetun left out reads as empty. */
  async getPublicIp(): Promise<GluetunPublicIp> {
    const reply = await this.http.get<GluetunPublicIpReply>("publicip/ip").json();

    return {
      public_ip: GluetunClient.text(reply?.public_ip),
      city: GluetunClient.text(reply?.city),
      country: GluetunClient.text(reply?.country),
    };
  }

  /** A reply field as text: absent, or anything but a string, reads as empty. */
  private static text(field: unknown): string {
    return typeof field === "string" ? field : "";
  }
}
