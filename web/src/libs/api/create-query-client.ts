import { MutationCache, QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { ApiError } from "./api-fetch.ts";

declare module "@tanstack/react-query" {
  interface Register {
    /** What a mutation's options say of it to the client (ADR 0002, decision 2). */
    mutationMeta: {
      /**
       * The reads a success makes stale, each a key or the prefix of a whole area (`["api", "docker"]`): the client
       * reads them again, and the mutation stays pending until they are done. Never on a failure: "read again whatever
       * the outcome" is the mutation's own `onSettled`.
       */
      invalidates?: readonly QueryKey[];
    };
  }
}

/** How many times a query that failed on the server's side is asked again. */
const retries = 3;

/**
 * The page's query client, which calls `onUnauthorized` whenever the server answers a query or a mutation with a 401:
 * the session has expired, or its user is no longer in `hangar.yml`. A mutation that succeeds has the reads its
 * `meta.invalidates` names read again, and stays pending until they are.
 */
export function createQueryClient(onUnauthorized: () => void = () => {}): QueryClient {
  const onError = (error: Error) => {
    if (isUnauthorized(error)) {
      onUnauthorized();
    }
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({
      onError,
      // Awaited by the mutation, before its own `onSuccess`: a form keyed by its read opens on what was saved.
      onSuccess: async (_data, _variables, _onMutateResult, mutation, { client }) => {
        const stale = mutation.meta?.invalidates ?? [];

        await Promise.all(stale.map(queryKey => client.invalidateQueries({ queryKey })));
      },
    }),
    defaultOptions: { queries: { retry: shouldRetry } },
  });
}

/** Whether `error` is the server's 401. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** An error below 500 answers the same when asked again: a missing app, a refused session. */
function shouldRetry(failures: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) {
    return false;
  }

  return failures < retries;
}
