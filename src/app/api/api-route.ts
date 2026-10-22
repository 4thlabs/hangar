import { PassThrough, Readable, Writable } from "node:stream";
import { sessions } from "#libs/auth/server";
import { NotFoundError } from "#libs/hangar";
import { logger } from "#libs/logs";

/** Error response for the API routes: the client only renders the message, the status is the machine-readable part. */
export function apiError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status });
}

type ApiStreamOptions = {
  /** Defaults to plain text; the event-stream routes go through `sseStream`. */
  contentType?: string;
  /** Sent beside the ones that keep the stream unbuffered. */
  headers?: Record<string, string>;
};

/** Streams a Node readable live, unbuffered end to end, or the output only shows up once the command is over. */
export function apiStream(
  stream: Readable,
  { contentType = "text/plain; charset=utf-8", headers = {} }: ApiStreamOptions = {},
): Response {
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      ...headers,
      "Cache-Control": "no-cache, no-store",
      "Content-Type": contentType,
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Streams the output of commands that outlive the request: leaving the page must not stop them.
 *
 * The commands write to a stand-in rather than to the response: once the page is closed, the response
 * stream is destroyed, and a child piped into it would no longer be read and block on its own output.
 * The stand-in forwards while the page reads, drops the rest after, and never holds a command back.
 * @param run Writes the output and ends the stream; not awaited, so it reports its own outcome
 */
export function apiCommandStream(run: (output: Writable) => Promise<void>): Response {
  const response = new PassThrough();

  // A closed page destroys the response with an error, which must not crash the server.
  response.on("error", () => {});

  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!response.destroyed) {
        response.write(chunk);
      }

      callback();
    },
    final(callback) {
      if (!response.destroyed) {
        response.end();
      }

      callback();
    },
  });

  void run(output);

  return apiStream(response);
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
  return apiStream(Readable.from(frames, { objectMode: false }), {
    contentType: "text/event-stream; charset=utf-8",
  });
}

type ApiRouteOptions = {
  /** Logged server-side when the handler throws something unexpected. */
  log: string;
  /** Returned with 503 when the handler throws something unexpected. */
  unavailable: string;
  /** Returned with 404 when the handler throws a `NotFoundError`. Omit to treat it as a 503. */
  notFound?: string;
};

type RouteContext = { params?: Record<string, string> };

type Session = NonNullable<Awaited<ReturnType<typeof sessions.get>>>;

/** 401 for anonymous, 404 for NotFoundError, opaque 503 (logged) otherwise. Hands the session to the handler. */
export function apiRoute<C extends RouteContext = RouteContext>(
  options: ApiRouteOptions,
  handler: (request: Request, context: C, session: Session) => Promise<Response>,
) {
  return async (request: Request, context = {} as C): Promise<Response> => {
    const session = await sessions.get(request);

    if (!session) {
      return apiError("Authentification requise.", 401);
    }

    try {
      return await handler(request, context, session);
    } catch (error) {
      if (options.notFound !== undefined && error instanceof NotFoundError) {
        return apiError(options.notFound, 404);
      }

      logger.error(options.log, { error, ...context.params });

      return apiError(options.unavailable, 503);
    }
  };
}
