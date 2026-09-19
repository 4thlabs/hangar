import { Readable } from "node:stream";
import { getSession } from "#libs/auth";
import { DockerNotFoundError } from "#libs/docker";
import { logger } from "#libs/logs";

/**
 * Error response for the API routes. The client only ever renders the message,
 * so the HTTP status carries the machine-readable part.
 * @param message Message shown to the user, in French
 * @param status HTTP status to respond with
 */
export function apiError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status });
}

/**
 * Streams a Node readable live: no buffering anywhere between the producer and the browser,
 * or the output only shows up once the command is over.
 * @param contentType Defaults to plain text; the event-stream routes go through `sseStream`
 */
export function apiStream(stream: Readable, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      "Content-Type": contentType,
      "X-Accel-Buffering": "no",
    },
  });
}

/** One Server-Sent Event, carrying a JSON payload. */
export const sseEvent = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

/**
 * Streams an async generator of `sseEvent` frames as Server-Sent Events.
 * @param frames Yields one `sseEvent` string per event, and ends when the client goes away
 */
export function sseStream(frames: AsyncIterable<string>): Response {
  // `objectMode: false` so the frames reach the response as bytes; the default would hand
  // `Response` raw strings, which it rejects.
  return apiStream(Readable.from(frames, { objectMode: false }), "text/event-stream; charset=utf-8");
}

type ApiRouteOptions = {
  /** Logged server-side when the handler throws something unexpected. */
  log: string;
  /** Returned with 503 when the handler throws something unexpected. */
  unavailable: string;
  /** Returned with 404 when the handler throws `DockerNotFoundError`. Omit to treat it as a 503. */
  notFound?: string;
};

type RouteContext = { params?: Record<string, string> };

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Wraps an API route with what all of them owe the caller: reject anonymous requests before
 * touching anything, turn a missing subject into a 404, and turn anything else into a 503 whose
 * body says nothing about the underlying error — the details go to the log, not to the client.
 *
 * The session is handed to the handler rather than looked up again: routes that write
 * notifications need the user id, and a second lookup is a second query for what we already have.
 *
 * @param options Messages for the failure paths
 * @param handler The route body, free to throw
 */
export function apiRoute<C extends RouteContext = RouteContext>(
  options: ApiRouteOptions,
  handler: (request: Request, context: C, session: Session) => Promise<Response>,
) {
  return async (request: Request, context = {} as C): Promise<Response> => {
    const session = await getSession(request);

    if (!session) return apiError("Authentification requise.", 401);

    try {
      return await handler(request, context, session);
    } catch (error) {
      if (options.notFound !== undefined && error instanceof DockerNotFoundError) {
        return apiError(options.notFound, 404);
      }

      logger.error(options.log, { error, ...context.params });
      return apiError(options.unavailable, 503);
    }
  };
}
