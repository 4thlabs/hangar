import { Readable } from "node:stream";
import type { DockerApiResult } from "./types.ts";

/**
 * Error response for the Docker API routes. The client only ever renders the message,
 * so the HTTP status carries the machine-readable part.
 * @param message Message shown to the user, in French
 * @param status HTTP status to respond with
 */
export function dockerError(message: string, status: number): Response {
  const result: DockerApiResult<never> = { success: false, error: { message } };

  return Response.json(result, { status });
}

/** 401 response for Docker API routes: unauthenticated request. */
export const unauthorizedDockerResponse = () => dockerError("Authentification requise.", 401);

/**
 * Success response for the Docker API routes. Never cached: every one of these is a live
 * sample of the daemon, and a stale one is worse than none.
 * @param data The snapshot to send
 */
export function dockerOk<T>(data: T): Response {
  const result: DockerApiResult<T> = { success: true, data };

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Streams a Node readable as live plain text: no buffering anywhere between the child
 * process and the browser, or the output only shows up once the command is over.
 */
export function dockerTextStream(stream: Readable): Response {
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
