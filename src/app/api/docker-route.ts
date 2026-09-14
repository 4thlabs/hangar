import { Readable } from "node:stream";
import { getSession } from "#libs/auth";
import { DockerNotFoundError } from "#libs/docker/compose.ts";
import { logger } from "#libs/logs";

/**
 * Error response for the Docker API routes. The client only ever renders the message,
 * so the HTTP status carries the machine-readable part.
 * @param message Message shown to the user, in French
 * @param status HTTP status to respond with
 */
export function dockerError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status });
}

/**
 * Streams a Node readable live: no buffering anywhere between the producer and the browser,
 * or the output only shows up once the command is over.
 * @param contentType Defaults to plain text; the statistics route sends an event stream
 */
export function dockerStream(stream: Readable, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      "Content-Type": contentType,
      "X-Accel-Buffering": "no",
    },
  });
}

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
    if (!(await getSession(request))) return dockerError("Authentification requise.", 401);

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
