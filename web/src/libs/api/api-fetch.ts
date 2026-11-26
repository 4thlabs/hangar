import type { Problem } from "./generated.ts";

/**
 * An error the server answered, its message the problem's detail, in English: what the page shows. Every error of
 * the server is an `application/problem+json` problem; a proxy that cannot reach it answers with none, and the
 * status alone is the error.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? problem?.title ?? `the server answered ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  /** The error of `response`, with its problem when it carries one; a body may be cut, and then it carries none. */
  static async read(response: Response): Promise<ApiError> {
    if (!response.headers.get("Content-Type")?.startsWith("application/problem+json")) {
      return new ApiError(response.status);
    }

    try {
      return new ApiError(response.status, (await response.json()) as Problem);
    } catch {
      return new ApiError(response.status);
    }
  }
}

/** The error type of orval's hooks, whatever the problem a route declares: every one is a `Problem`. */
export type ErrorType<_Body> = ApiError;

/**
 * Every request of the hooks orval writes, named in `orval.config.ts`, which is why it is a function and not a
 * class's member. The page is served on the server's own origin, so its cookie goes with each call: no credential
 * to add.
 */
export async function apiFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw await ApiError.read(response);
  }

  // A 204 or a 205 has no body: `null`, the JSON of an `Option` that is `None`.
  const empty = response.status === 204 || response.status === 205;

  return (empty ? null : await response.json()) as T;
}
