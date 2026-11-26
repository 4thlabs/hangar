import type { ErrorDetail, Problem } from "./generated.ts";

/**
 * An error the server answered, its message the problem's detail, in English. Every error of the server is an
 * `application/problem+json` problem; one of Hangar's own carries its code as its `type`, `/problems/<code>`, and its
 * params as extension members, which `detail` gives back as the `ErrorDetail` a body carries. A proxy that cannot
 * reach the server answers with no problem, and the status alone is the error.
 */
export class ApiError extends Error {
  /** What the `type` of a problem of Hangar's holds before its code. */
  static readonly ProblemTypePrefix = "/problems/";

  /** The members of a problem that RFC 9457 names, which are no param. */
  private static readonly ProblemMembers = new Set(["type", "title", "status", "detail", "instance"]);

  readonly status: number;
  readonly problem: Problem | undefined;
  /** The code of the error, its params and its English message, when it is one of Hangar's own. */
  readonly detail: ErrorDetail | undefined;
  /** The seconds the answer's `Retry-After` says to wait before trying again, as a 429 says. */
  readonly retryAfter: number | undefined;

  constructor(status: number, problem?: Problem, retryAfter?: number) {
    super(problem?.detail ?? problem?.title ?? `the server answered ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
    this.detail = problem ? ApiError.detailOf(problem) : undefined;
    this.retryAfter = retryAfter;
  }

  /** The error of `response`, with its problem when it carries one; a body may be cut, and then it carries none. */
  static async read(response: Response): Promise<ApiError> {
    const retryAfter = ApiError.seconds(response.headers.get("Retry-After"));

    if (!response.headers.get("Content-Type")?.startsWith("application/problem+json")) {
      return new ApiError(response.status, undefined, retryAfter);
    }

    try {
      return new ApiError(response.status, (await response.json()) as Problem, retryAfter);
    } catch {
      return new ApiError(response.status, undefined, retryAfter);
    }
  }

  /**
   * The code, the params and the message of `problem`, read from its `type` and its extension members; none for a
   * problem quoll answers itself, `about:blank`, or one with no detail. The server writes a code's params as the
   * contract says, so they are taken as they come.
   */
  private static detailOf(problem: Problem): ErrorDetail | undefined {
    const code = problem.type?.startsWith(ApiError.ProblemTypePrefix)
      ? problem.type.slice(ApiError.ProblemTypePrefix.length)
      : undefined;

    if (!code || problem.detail === undefined) {
      return undefined;
    }

    const params = Object.fromEntries(
      Object.entries(problem).filter(([member]) => !ApiError.ProblemMembers.has(member)),
    );

    return { code, params, message: problem.detail } as ErrorDetail;
  }

  /** The seconds of a `Retry-After` written as a number of them, which is how the server writes it. */
  private static seconds(header: string | null): number | undefined {
    if (header === null || !/^\d+$/.test(header)) {
      return undefined;
    }

    return Number(header);
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
