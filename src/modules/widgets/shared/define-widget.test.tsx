import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, fulfilled, peek } from "#libs/cache";
import { WidgetIcon } from "../config/config.ts";
import { clearWidgetCache, defineWidget, type WidgetBody } from "./define-widget.tsx";

const appearance = {
  title: "Test",
  icon: new WidgetIcon("/test.svg"),
  className: "min-h-10",
  errorDescription: "Could not load.",
};

/** A widget over a body whose module is already loaded, as a warm dashboard has it. */
const warmWidget = <T,>(body: WidgetBody<T>, ttl?: number) =>
  defineWidget({ id: "test-widget", appearance, body: () => fulfilled(body), ttl });

// The widget cache is process-global and keyed by placement, and every unplaced widget here shares one key.
beforeEach(clearWidgetCache);

describe("defineWidget", () => {
  it("renders the loaded data", async () => {
    const widget = warmWidget({
      load: async () => "payload",
      render: data => <p>{data}</p>,
    });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("payload");
  });

  it("falls back to the error card when load rejects", async () => {
    const widget = warmWidget({
      load: async () => {
        throw new Error("upstream down");
      },
      render: () => <p>never</p>,
    });

    const html = renderToStaticMarkup(await widget.Widget());

    expect(html).toContain("Test is unavailable");
    expect(html).toContain("Could not load.");
    expect(html).not.toContain("never");
  });

  it("does not leak the upstream error message to the page", async () => {
    const widget = warmWidget({
      load: async () => {
        throw new Error("postgres://user:secret@db:5432 refused");
      },
      render: () => <p>never</p>,
    });

    expect(renderToStaticMarkup(await widget.Widget())).not.toContain("secret");
  });

  it("falls back when render returns null", async () => {
    const widget = warmWidget({
      load: async () => null,
      render: () => null,
    });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Test is unavailable");
  });

  it("derives the skeleton from the same identity", () => {
    const widget = warmWidget({
      load: async () => "x",
      render: () => <p>x</p>,
    });

    const html = renderToStaticMarkup(<widget.Skeleton />);

    expect(html).toContain("Test");
    expect(html).toContain("min-h-10");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("defineWidget over a module", () => {
  it("renders the card's error state when the widget's module fails to load", async () => {
    const widget = defineWidget({
      id: "test-widget",
      appearance,
      body: () => Promise.reject(new Error("chunk missing")),
    });

    const html = renderToStaticMarkup(await widget.Widget());

    expect(html).toContain("Test is unavailable");
    expect(html).not.toContain("chunk missing");
  });

  it("renders the card's error state when building the body throws before any promise", async () => {
    const widget = defineWidget({
      id: "test-widget",
      appearance,
      body: () => {
        throw new Error("no descriptor");
      },
    });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Test is unavailable");
  });

  it("suspends only its own card while the module loads, behind a skeleton drawn from its appearance", async () => {
    let loaded: (body: WidgetBody) => void = () => undefined;
    const body = new Promise<WidgetBody>(resolve => (loaded = resolve));
    const widget = defineWidget({ id: "test-widget", appearance, body: () => body });

    const card = widget.Widget();

    expect(peek(card)).toBeUndefined();
    expect(renderToStaticMarkup(<widget.Skeleton />)).toContain("Test");

    loaded({ load: async () => "payload", render: data => <p>{String(data)}</p> });
    expect(renderToStaticMarkup(await card)).toContain("payload");
  });
});

describe("defineWidget caching", () => {
  it("renders a second time from the cache rather than loading again", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = warmWidget({ load, render: data => <p>{data}</p> });

    await widget.Widget();
    await widget.Widget();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a load that rejected", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("service down"))
      .mockResolvedValue("payload");

    const widget = warmWidget({ load, render: data => <p>{data}</p> });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Could not load.");
    expect(renderToStaticMarkup(await widget.Widget())).toContain("payload");
  });

  it("caches the rendered card, so a warm render runs neither the load nor render", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const render = vi.fn((data: string) => <p>{data}</p>);
    const widget = warmWidget({ load, render });

    await widget.Widget();
    await widget.Widget();

    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("defineWidget placements", () => {
  it("keeps one cache entry per placement, so two of one type never share data", async () => {
    // Two `github-releases` blocks watching different repositories: one type, two answers.
    const make = (answer: string) => warmWidget({ load: () => Promise.resolve(answer), render: data => <p>{data}</p> });

    const first = make("first").at("test-widget-a");
    const second = make("second").at("test-widget-b");

    expect(renderToStaticMarkup(await first.Widget())).toContain("first");
    expect(renderToStaticMarkup(await second.Widget())).toContain("second");
  });

  it("binds a copy, leaving a shared widget as it was", () => {
    const widget = warmWidget({ load: async () => "x", render: () => <p>x</p> });

    expect(widget.at("test-widget-a").key).toBe("test-widget-a");
    expect(widget.key).toBe("test-widget");
  });

  it("hands its key to render, for whatever the card addresses per placement", async () => {
    const widget = warmWidget({ load: async () => "x", render: (_data, key) => <p>{key}</p> });

    expect(renderToStaticMarkup(await widget.at("test-widget-a").Widget())).toContain("test-widget-a");
  });
});

describe("defineWidget freshness", () => {
  const START = new Date("2026-01-01T00:00:00Z").getTime();

  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START));
  afterEach(() => vi.useRealTimers());

  it("reloads once past the TTL its placement declared", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = warmWidget({ load, render: data => <p>{data}</p> }, 5_000);

    await widget.Widget();
    vi.setSystemTime(START + 6_000);
    await widget.Widget();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("holds a widget that declared none for the default minute", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = warmWidget({ load, render: data => <p>{data}</p> });

    await widget.Widget();
    vi.setSystemTime(START + 6_000);
    await widget.Widget();

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("defineWidget rendering without suspending", () => {
  it("hands out a settled card once warm, which React renders without a fallback", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = warmWidget({ load, render: data => <p>{data}</p> });

    await widget.Widget();

    const card = peek(widget.Widget());

    expect(card).toBeDefined();
    expect(renderToStaticMarkup(card?.value as React.ReactElement)).toContain("payload");
  });

  it("still suspends when it has nothing cached", () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = warmWidget({ load, render: data => <p>{data}</p> });

    expect(peek(widget.Widget())).toBeUndefined();
  });
});

describe("defineWidget over a source", () => {
  it("renders straight from the source it is given, without a cache of its own", async () => {
    const owner = new Cache();
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const source = () => owner.get("source", { ttl: 60_000 }, load);
    const widget = warmWidget({ source, render: data => <p>{data}</p> });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("first");

    // Whatever refreshes the owner's value shows here at once, with no widget TTL to outlive.
    await owner.refresh("source");
    expect(renderToStaticMarkup(peek(widget.Widget())?.value as React.ReactElement)).toContain("second");
  });

  it("falls back to the error card when the source cannot be read", async () => {
    const widget = warmWidget({
      source: () => Promise.reject(new Error("socket gone")),
      render: () => <p>never</p>,
    });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Test is unavailable");
  });
});
