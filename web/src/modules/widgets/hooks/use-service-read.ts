import {
  useQuery,
  type DataTag,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

/** The parts `Read` asks for: those it gives `true` or a limit, not those it leaves out or gives `false`. */
type AskedParts<Read> = {
  [Part in keyof Read]-?: Read[Part] extends false | null | undefined ? never : Part;
}[keyof Read];

/** What a read of `Read` gives of a service's `Data`: each part it asked, never null; the others as the server sent them. */
export type ServiceParts<Data, Read> = Omit<Data, AskedParts<Read> & keyof Data> & {
  readonly [Part in AskedParts<Read> & keyof Data]-?: NonNullable<Data[Part]>;
};

/** A service's read, as `servicesQueries` writes it: the query options of the placement `widget`, asked `read`. */
type ServiceQuery<Data, Failure, Params> = (
  widget: string,
  read: Params,
) => UseQueryOptions<Data, Failure, Data> & { queryKey: DataTag<QueryKey, Data, Failure> };

/** Whether `data` holds each part `read` asked for. */
export function hasParts<Data extends object, Read extends object>(
  data: Data,
  read: Read,
): data is Data & ServiceParts<Data, Read> {
  const present = new Set(
    Object.entries(data)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([part]) => part),
  );

  return Object.entries(read)
    .filter(([, asked]) => asked !== false && asked !== null && asked !== undefined)
    .every(([part]) => present.has(part));
}

/**
 * What the service of the widget placed as `widget` answers to `read`, through its options in `servicesQueries`: each
 * part the read asks is there, typed so, with no `?`, `!` or cast; a part it did not ask is possibly `null` (TS18047).
 * An answer that leaves out a part asked fails the query, which the card's region shows.
 *
 * Write the read as a constant, `as const satisfies` the service's params (`ServicesJellyfinParams`). The `satisfies` is
 * needed: a read written in the call is inferred, and inference does not refuse a part the service does not have, which
 * would then fail at run time. And the service is checked only by the parts' names: a read of another service that
 * names a part of the same name is refused where its data is read (TS2339), not at the call.
 */
export function useServiceRead<Data extends object, Failure, Params extends object, Read extends Params>(
  query: ServiceQuery<Data, Failure, Params>,
  widget: string,
  read: Read,
): UseQueryResult<ServiceParts<Data, Read>, Failure> {
  return useQuery({
    ...query(widget, read),
    select: (data: Data) => {
      if (!hasParts(data, read)) {
        throw new Error("the server left out a part the card asked for");
      }

      return data;
    },
  });
}
