import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { Hono } from "hono/tiny";
import compress from "./compress.ts";

/** Big enough to clear the threshold, compressible enough to prove the body survived. */
const SHELL = `SHELL ${"x".repeat(4_000)}`;
const LATE = `LATE ${"y".repeat(4_000)}`;

/**
 * An app that answers one streamed response, with the middleware in front.
 * @param contentType `null` answers with no headers at all, the way Waku hands over an RSC payload
 * @param path Served and requested as-is, because the RSC prefix is part of what decides
 */
function app(contentType: string | null, frames: AsyncIterable<string>, path = "/") {
  const hono = new Hono();
  hono.use(compress());
  hono.get(
    path,
    () =>
      new Response(
        Readable.toWeb(Readable.from(frames, { objectMode: false })) as ReadableStream<Uint8Array>,
        contentType === null ? undefined : { headers: { "Content-Type": contentType } },
      ),
  );

  return hono.request(path, { headers: { "Accept-Encoding": "gzip" } });
}

/** Reads a response body, decoding it when it says it is gzipped, one decoded chunk at a time. */
async function* read(response: Response) {
  const body = response.headers.get("Content-Encoding")
    ? response.body!.pipeThrough(new DecompressionStream("gzip"))
    : response.body!;

  const decoder = new TextDecoder();
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) yield decoder.decode(chunk);
}

describe("compress middleware", () => {
  it("delivers the shell before the rest of the stream exists", async () => {
    // The regression this middleware was rewritten for: `hono/compress` encodes through
    // `CompressionStream`, which holds every byte until the stream ends. A page that paints a
    // shell and fills its Suspense boundaries afterwards then arrives all at once, late.
    let released = false;

    async function* frames() {
      yield SHELL;
      // Only resolves once the shell has been read, so the assertion cannot pass by racing.
      while (!released) await new Promise(resolve => setTimeout(resolve, 5));
      yield LATE;
    }

    const response = await app("text/plain; charset=utf-8", frames());
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");

    const chunks = read(response);
    const first = await chunks.next();

    expect(first.value).toContain("SHELL");
    released = true;

    const rest = [];
    for await (const chunk of chunks) rest.push(chunk);
    expect(rest.join("")).toContain("LATE");
  });

  it("encodes an RSC payload, which arrives carrying no headers at all", async () => {
    // Waku hands the adapter a bare `new Response(stream)`; the `text/plain` on the wire is added
    // below this middleware. Filtering on content type alone silently skips every payload.
    async function* frames() {
      yield SHELL;
    }

    const response = await app(null, frames(), "/RSC/R/store.txt");

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
  });

  it("leaves a headerless response outside the RSC prefix alone", async () => {
    async function* frames() {
      yield SHELL;
    }

    const response = await app(null, frames(), "/api/something");

    expect(response.headers.get("Content-Encoding")).toBeNull();
  });

  it("leaves an event stream alone, so its frames are not held in a compression buffer", async () => {
    async function* frames() {
      yield `data: ${SHELL}\n\n`;
    }

    const response = await app("text/event-stream; charset=utf-8", frames());

    expect(response.headers.get("Content-Encoding")).toBeNull();
    await expect(response.text()).resolves.toContain("SHELL");
  });
});
