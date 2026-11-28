import type { ReactNode } from "react";
import type { WidgetPlacement } from "#libs/api";
import { QueryRegion } from "#modules/common/components/region.tsx";
import type { WidgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { useServiceRead, type ServiceParts, type ServiceQuery } from "#modules/widgets/hooks/use-service-read.ts";
import { WidgetFailure, WidgetSkeleton } from "./widget-states.tsx";

type ServiceWidgetProps<Data, Failure, Params, Read> = {
  /** The service's read, from `servicesQueries`. */
  query: ServiceQuery<Data, Failure, Params>;
  placement: WidgetPlacement;
  /** What the card shows of the service, `as const satisfies` its params. */
  read: Read;
  look: WidgetLook;
  /** The card of the parts read, each part asked there. */
  children: (parts: ServiceParts<Data, Read>) => ReactNode;
};

/**
 * A widget that reads its service, in its own region: its skeleton while the parts come, its error when its service did
 * not answer, and its card once read, which renders the next answer when it threw on one. Each widget waits for its own:
 * a slow service holds its card alone. A card that has data keeps it when it is read again and that fails: the server
 * keeps a service's last answer for 15 minutes, and says when it is too old.
 */
export function ServiceWidget<Data extends object, Failure extends Error, Params extends object, Read extends Params>({
  query,
  placement,
  read,
  look,
  children,
}: ServiceWidgetProps<Data, Failure, Params, Read>) {
  const parts = useServiceRead(query, placement.key, read);

  return (
    <QueryRegion
      query={parts}
      fallback={<WidgetSkeleton look={look} />}
      failure={failure => <WidgetFailure look={look} {...failure} />}
    >
      {children}
    </QueryRegion>
  );
}
