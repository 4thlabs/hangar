import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";
import type { ArcaneResult, Dashboard } from "./type.ts";

/** Talks to one Arcane instance. */
export class ArcaneClient extends ServiceClient {
  /** Arcane's own host, the only environment Hangar reads. */
  private static readonly LocalEnvironment = 0;

  static async connect(service: WidgetService) {
    return new ArcaneClient(await ServiceClient.client(service));
  }

  getDashboard() {
    return this.http.get<ArcaneResult<Dashboard>>(`/environments/${ArcaneClient.LocalEnvironment}/dashboard`).json();
  }
}
