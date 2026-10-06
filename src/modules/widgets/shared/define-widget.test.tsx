import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "#libs/cache";
import { clearWidgetCache, defineWidget } from "./define-widget.tsx";

const base = {
  id: "test-widget",
  title: "Test",
  icon: null,
  className: "min-h-10",
  errorDescription: "Could not load.",
};

// The widget cache is process-global and keyed by placement, and every unplaced widget here shares one key.
beforeEach(clearWidgetCache);

describe("defineWidget", () => {
  it("renders the loaded data", async () => {
    const widget = defineWidget({
      ...base,
      load: async () => "payload",
      render: data => <p>{data}</p>,
    });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("payload");
  });

  it("falls back to the error card when load rejects", async () => {
    const widget = defineWidget({
      ...base,
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
    const widget = defineWidget({
      ...base,
      load: async () => {
        throw new Error("postgres://user:secret@db:5432 refused");
      },
      render: () => <p>never</p>,
    });

    expect(renderToStaticMarkup(await widget.Widget())).not.toContain("secret");
  });

  it("falls back when render returns null", async () => {
    const widget = defineWidget({
      ...base,
      load: async () => null,
      render: () => null,
    });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Test is unavailable");
  });

  it("derives the skeleton from the same identity", () => {
    const widget = defineWidget({
      ...base,
      load: async () => "x",
      render: () => <p>x</p>,
    });

    const html = renderToStaticMarkup(<widget.Skeleton />);

    expect(html).toContain("Test");
    expect(html).toContain("min-h-10");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("defineWidget caching", () => {
  it("renders a second time from the snapshot rather than loading again", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    await widget.Widget();
    await widget.Widget();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a load that rejected", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("service down"))
      .mockResolvedValue("payload");

    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Could not load.");
    expect(renderToStaticMarkup(await widget.Widget())).toContain("payload");
  });

  it("warms the snapshot so the next render does not load", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    await widget.warm();

    expect(renderToStaticMarkup(await widget.Widget())).toContain("payload");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("resolves rather than rejects when warming a service that is down", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("service down"));
    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    await expect(widget.warm()).resolves.toBeUndefined();
  });
});

describe("defineWidget placements", () => {
  it("keeps one cache entry per placement, so two of one type never share data", async () => {
    // Two `github-releases` blocks watching different repositories: one type, two answers.
    const make = (answer: string) =>
      defineWidget({ ...base, load: () => Promise.resolve(answer), render: data => <p>{data}</p> });

    const first = make("first").at("test-widget-a");
    const second = make("second").at("test-widget-b");

    expect(renderToStaticMarkup(await first.Widget())).toContain("first");
    expect(renderToStaticMarkup(await second.Widget())).toContain("second");
  });

  it("binds a copy, leaving a shared widget as it was", () => {
    const widget = defineWidget({ ...base, load: async () => "x", render: () => <p>x</p> });

    expect(widget.at("test-widget-a").key).toBe("test-widget-a");
    expect(widget.key).toBe("test-widget");
  });

  it("hands its key to render, for whatever the card addresses per placement", async () => {
    const widget = defineWidget({ ...base, load: async () => "x", render: (_data, key) => <p>{key}</p> });

    expect(renderToStaticMarkup(await widget.at("test-widget-a").Widget())).toContain("test-widget-a");
  });
});

describe("defineWidget freshness", () => {
  const START = new Date("2026-01-01T00:00:00Z").getTime();

  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START));
  afterEach(() => vi.useRealTimers());

  it("reloads once past the TTL its placement declared", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = defineWidget({ ...base, ttl: 5_000, load, render: data => <p>{data}</p> });

    await widget.Widget();
    vi.setSystemTime(START + 6_000);
    await widget.Widget();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("holds a widget that declared none for the default minute", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    await widget.Widget();
    vi.setSystemTime(START + 6_000);
    await widget.Widget();

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("defineWidget rendering without suspending", () => {
  it("renders synchronously once warm, so no Suspense boundary is created", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    await widget.warm();

    // Not a promise: an async component would suspend, and a suspended boundary puts its skeleton
    // in the shell however fast the data arrives.
    const rendered = widget.Widget();

    expect(rendered).not.toBeInstanceOf(Promise);
    expect(renderToStaticMarkup(rendered as React.ReactElement)).toContain("payload");
  });

  it("still suspends when it has nothing cached", () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("payload");
    const widget = defineWidget({ ...base, load, render: data => <p>{data}</p> });

    expect(widget.Widget()).toBeInstanceOf(Promise);
  });
});

describe("defineWidget over a snapshot", () => {
  it("renders straight from the snapshot it is given, without a copy of its own", async () => {
    const owner = new Cache();
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const snapshot = owner.define("source", 60_000, 60_000, load);
    const widget = defineWidget({ ...base, snapshot, render: data => <p>{data}</p> });

    await widget.warm();
    expect(renderToStaticMarkup(widget.Widget() as React.ReactElement)).toContain("first");

    // Whatever refreshes the owner's snapshot shows here at once, with no widget TTL to outlive.
    await snapshot.refresh();
    expect(renderToStaticMarkup(widget.Widget() as React.ReactElement)).toContain("second");
  });

  it("falls back to the error card when the snapshot cannot be read", async () => {
    const snapshot = new Cache().define("source", 60_000, 60_000, () => Promise.reject(new Error("socket gone")));
    const widget = defineWidget({ ...base, snapshot, render: () => <p>never</p> });

    expect(renderToStaticMarkup(await widget.Widget())).toContain("Test is unavailable");
  });
});
