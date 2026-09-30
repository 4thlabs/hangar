import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MinifluxEntry } from "./api/client.ts";
import { MinifluxEntriesCard, minifluxEntries } from "./entries.tsx";
import { clearWidgetCache } from "../shared/define-widget.tsx";

beforeEach(clearWidgetCache);
afterEach(() => vi.unstubAllGlobals());

const now = 1_700_000_000_000;

const entries: MinifluxEntry[] = [
  {
    id: 1,
    title: "Fresh news",
    url: "https://blog.example.com/fresh",
    published_at: new Date(now - 120_000).toISOString(),
    status: "unread",
    feed: { title: "Example blog" },
  },
  {
    id: 2,
    title: "Old news",
    url: "https://blog.example.com/old",
    published_at: new Date(now - 7_200_000).toISOString(),
    status: "read",
    feed: { title: "Example blog" },
  },
];

describe("MinifluxEntriesCard", () => {
  it("marks only the unread entries and counts them in the header", () => {
    const html = renderToStaticMarkup(
      <MinifluxEntriesCard entries={entries} unread={42} serviceUrl="https://miniflux.example.com" now={now} />,
    );

    expect(html).toContain("42 unread");
    expect(html).toContain(">Fresh news</a>");
    expect(html).toContain(">Old news</a>");
    expect(html).toContain('title="Example blog"');
    expect(html.match(/aria-label="Unread"/g)).toHaveLength(1);
  });

  it("renders the empty state when there are no entries", () => {
    const html = renderToStaticMarkup(
      <MinifluxEntriesCard entries={[]} unread={0} serviceUrl="https://miniflux.example.com" now={now} />,
    );

    expect(html).toContain("No entries.");
  });

  it("asks the Miniflux API with its token, which never reaches the page", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(Response.json({ total: request.url.includes("status=unread") ? 7 : 2, entries }));
    });

    const { Widget } = minifluxEntries({
      api: "http://miniflux:8080",
      link: "https://miniflux.test.local",
      apiKey: () => Promise.resolve("s3cret"),
    });
    const html = renderToStaticMarkup(<>{await Widget()}</>);

    expect(called.every(request => request.url.startsWith("http://miniflux:8080/v1/entries?"))).toBe(true);
    expect(called.map(request => request.headers.get("x-auth-token"))).toEqual(["s3cret", "s3cret"]);
    expect(html).toContain("7 unread");
    expect(html).toContain("https://miniflux.test.local");
    expect(html).not.toContain("s3cret");
  });

  it("falls back to the error card when Miniflux does not answer", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 500 })));

    const { Widget } = minifluxEntries({
      api: "http://miniflux:8080",
      link: "https://miniflux.test.local",
      apiKey: () => Promise.resolve(undefined),
    });
    const html = renderToStaticMarkup(<>{await Widget()}</>);

    expect(html).toContain("unavailable");
  });
});
