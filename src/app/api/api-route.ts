import { Readable } from "node:stream";
import { getSession } from "#libs/auth";
import { DockerNotFoundError } from "#libs/docker";
import { logger } from "#libs/logs";

/** Error response for the API routes: the client only renders the message, the status is the machine-readable part. */
export function apiError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status });
}

/**
 * Streams a Node readable live, unbuffered end to end, or the output only shows up once the command is over.
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

/** 401 for anonymous, 404 for DockerNotFoundError, opaque 503 (logged) otherwise. Hands the session to the handler. */
export function apiRoute<C extends RouteContext = RouteContext>(
  options: ApiRouteOptions,
  handler: (request: Request, context: C, session: Session) => Promise<Response>,
) {
  return async (request: Request, context = {} as C): Promise<Response> => {
    const session = await getSession(request);

    if (!session) {
      return apiError("Authentification requise.", 401);
    }

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
