import { getSession } from "#libs/auth";
import { dockerError, DockerNotFoundError, unauthorizedDockerResponse } from "#libs/docker";
import { logger } from "#libs/logs";

type DockerRouteOptions = {
  /** Logged server-side when the handler throws something unexpected. */
  log: string;
  /** Returned with 503 when the handler throws something unexpected. */
  unavailable: string;
  /** Returned with 404 when the handler throws `DockerNotFoundError`. Omit to treat it as a 503. */
  notFound?: string;
};

type RouteContext = { params?: Record<string, string> };

/**
 * Wraps a Docker API route with what all of them owe the caller: reject anonymous requests before
 * touching the daemon, turn a missing subject into a 404, and turn anything else into a 503 whose
 * body says nothing about the underlying error — the details go to the log, not to the client.
 *
 * @param options Messages for the failure paths
 * @param handler The route body, free to throw
 */
export function dockerRoute<C extends RouteContext = RouteContext>(
  options: DockerRouteOptions,
  handler: (request: Request, context: C) => Promise<Response>,
) {
  return async (request: Request, context = {} as C): Promise<Response> => {
    if (!(await getSession(request))) return unauthorizedDockerResponse();

    try {
      return await handler(request, context);
    } catch (error) {
      if (options.notFound !== undefined && error instanceof DockerNotFoundError) {
        return dockerError(options.notFound, 404);
      }

      logger.error({ error, ...context.params }, options.log);
      return dockerError(options.unavailable, 503);
    }
  };
}
