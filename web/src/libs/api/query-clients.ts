import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-fetch.ts";

/** The page's query client. */
export class QueryClients {
  /** How many times a query that failed on the server's side is asked again. */
  private static readonly Retries = 3;

  /**
   * The client, which calls `onUnauthorized` whenever the server answers a query or a mutation with a 401: the
   * session has expired, or its user is no longer in `hangar.yml`.
   */
  static create(onUnauthorized: () => void = () => {}): QueryClient {
    const onError = (error: Error) => {
      if (QueryClients.isUnauthorized(error)) {
        onUnauthorized();
      }
    };

    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: { queries: { retry: QueryClients.retries } },
    });
  }

  /** Whether `error` is the server's 401. */
  static isUnauthorized(error: unknown): boolean {
    return error instanceof ApiError && error.status === 401;
  }

  /** An error below 500 answers the same when asked again: a missing app, a refused session. */
  private static retries(failures: number, error: Error): boolean {
    if (error instanceof ApiError && error.status < 500) {
      return false;
    }

    return failures < QueryClients.Retries;
  }
}
