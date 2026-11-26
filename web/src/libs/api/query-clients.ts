import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-fetch.ts";

/** The page's query client. */
export class QueryClients {
  /** How many times a query that failed on the server's side is asked again. */
  private static readonly Retries = 3;

  static create(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: QueryClients.retries } } });
  }

  /** An error below 500 answers the same when asked again: a missing app, a refused session. */
  private static retries(failures: number, error: Error): boolean {
    if (error instanceof ApiError && error.status < 500) {
      return false;
    }

    return failures < QueryClients.Retries;
  }
}
