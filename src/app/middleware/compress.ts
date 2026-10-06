import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/compress";
import { logger } from "#libs/logs";
import type { MiddlewareHandler } from "hono/types";

/** Below this, the gzip header costs more than the encoding saves. Only checked when the length is known. */
const THRESHOLD = 1_024;

/** Waku's default `rscBase` under the default `basePath`; mirror any change to `waku.config.ts` here. */
const RSC_PREFIX = "/RSC/";

/**
 * Whether a response is worth encoding. An RSC payload arrives with no headers at all (Node adds `text/plain`
 * later), so a missing type is trusted under the RSC prefix only.
 */
const compressible = (type: string | null, path: string) =>
  type === null ? path.startsWith(RSC_PREFIX) : COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type);

/**
 * Gzips with Z_SYNC_FLUSH so streamed Suspense chunks flush per chunk (hono/compress buffers to the end).
 * Skips SSE (Hono's content-type test); /assets is the reverse proxy's job.
 */
export default (): MiddlewareHandler =>
  async function compress(c, next) {
    await next();

    const { body, headers } = c.res;
    const length = headers.get("Content-Length");

    if (
      c.req.method === "HEAD" ||
      !body ||
      headers.has("Content-Encoding") ||
      (length !== null && Number(length) < THRESHOLD) ||
      !compressible(headers.get("Content-Type"), c.req.path) ||
      !/(^|,)\s*gzip\s*(,|;|$)/i.test(c.req.header("Accept-Encoding") ?? "")
    ) {
      return;
    }

    const gzip = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });

    // Detached: the response is gzip's readable end, already flowing, so a failure can only truncate the body.
    // A client that hung up is the normal case and not logged.
    void pipeline(Readable.fromWeb(body as never), gzip).catch((error: unknown) => {
      if (!c.req.raw.signal.aborted) {
        logger.warn("Compressing a response failed", { error, path: c.req.path });
      }
    });

    c.res = new Response(Readable.toWeb(gzip) as ReadableStream<Uint8Array>, c.res);
    c.res.headers.delete("Content-Length");
    c.res.headers.set("Content-Encoding", "gzip");

    const vary = c.res.headers.get("Vary");
    if (vary !== "*" && !/(^|,)\s*accept-encoding\s*(,|$)/i.test(vary ?? "")) {
      c.res.headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
    }
  };
