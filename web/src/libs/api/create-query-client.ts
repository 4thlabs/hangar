import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-fetch.ts";

/** How many times a query that failed on the server's side is asked again. */
const retries = 3;

/**
 * The page's query client, which calls `onUnauthorized` whenever the server answers a query or a mutation with a 401:
 * the session has expired, or its user is no longer in `hangar.yml`.
 */
export function createQueryClient(onUnauthorized: () => void = () => {}): QueryClient {
  const onError = (error: Error) => {
    if (isUnauthorized(error)) {
      onUnauthorized();
    }
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
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
