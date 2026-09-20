import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/compress";
import type { MiddlewareHandler } from "hono/types";

/** Below this, the gzip header costs more than the encoding saves. Only checked when the length is known. */
const THRESHOLD = 1_024;

/**
 * Waku's default `rscBase`, under the default `basePath`. Neither is overridden in
 * `waku.config.ts`; a change there has to be mirrored here. See {@link compressible}.
 */
const RSC_PREFIX = "/RSC/";

/**
 * Whether a response is worth encoding.
 *
 * An RSC payload arrives here as a bare `new Response(stream)` with **no headers at all** — the
 * `text/plain` you see on the wire is added further down, by the Node server. So the content
 * type cannot be the only test, or the payloads that matter most (70 kB for `/store`, resent on
 * every navigation) are the exact ones that go out raw. A missing type is trusted only under the
 * RSC prefix; anywhere else it could be anything, and an unknown body is left alone.
 */
const compressible = (type: string | null, path: string) =>
  type === null ? path.startsWith(RSC_PREFIX) : COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type);

/**
 * Compresses what Waku itself answers: the HTML shell, every RSC payload, and the JSON API
 * routes. Nothing did before, and the RSC payloads are the worst of it — `/store` alone is 70 kB
 * of text that gzips to 4.5 kB, paid again on every navigation.
 *
 * Not `hono/compress`: it encodes through `CompressionStream`, which holds everything until the
 * stream ends. That is fine for a buffered response and wrong for every page here, which streams
 * a shell and fills its Suspense boundaries afterwards — a 2 kB shell followed by a 1.5 s wait
 * came out at 1511 ms rather than 2 ms. `Z_SYNC_FLUSH` ends a deflate block per chunk instead,
 * so the shell reaches the browser while the daemon is still being asked.
 *
 * Sorts first in `middleware/`, which is the order Waku runs them in, so it wraps the others.
 * The content-type test is Hono's own, and its `text/(?!event-stream)` is what leaves the two
 * live streams alone — an SSE frame inside a compression buffer is a frame nobody receives.
 *
 * Not the static assets: the adapter serves `/assets/*` before any of this runs. Those are the
 * reverse proxy's job — see the `compress` middleware on the router in `compose.prod.yml`.
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

    // Detached on purpose: the response is the compressor's readable end, which is already
    // flowing to the client. A failure upstream destroys `gzip`, which ends that stream — the
    // status line left long ago, so a truncated body is all the client can be told.
    void pipeline(Readable.fromWeb(body as never), gzip).catch(() => {});

    c.res = new Response(Readable.toWeb(gzip) as ReadableStream<Uint8Array>, c.res);
    c.res.headers.delete("Content-Length");
    c.res.headers.set("Content-Encoding", "gzip");

    const vary = c.res.headers.get("Vary");
    if (vary !== "*" && !/(^|,)\s*accept-encoding\s*(,|$)/i.test(vary ?? "")) {
      c.res.headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
    }
  };
