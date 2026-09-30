import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";
import type { ArcaneResult, Dashboard } from "./type.ts";

/** Talks to one Arcane instance. */
export class ArcaneClient extends ServiceClient {
  /**
   * Opens a client for the Arcane instance `service` points at.
   */
  static async connect(service: WidgetService) {
    return new ArcaneClient(await ServiceClient.client(service));
  }

  /**
   * Gets the aggregated dashboard for an environment.
   */
  getDashboard(environment: number = 0) {
    return this.http.get<ArcaneResult<Dashboard>>(`/environments/${environment}/dashboard`).json();
  }
}
