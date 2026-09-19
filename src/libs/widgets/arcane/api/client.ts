import type { WidgetService } from "../../config/config.ts";
import { serviceClient } from "../../shared/service-client.ts";
import type { ArcaneResult, Dashboard } from "./type.ts";

/** Talks to one Arcane instance. */
export async function createArcaneClient(service: WidgetService) {
  const client = await serviceClient(service);

  return {
    /** Gets the aggregated dashboard for an environment. */
    getDashboard: (environment: number = 0) =>
      client.get<ArcaneResult<Dashboard>>(`/environments/${environment}/dashboard`).json(),
  };
}
