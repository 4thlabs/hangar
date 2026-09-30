import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWidgetCache, defineWidget } from "./define-widget.tsx";

const base = {
  id: "test-widget",
  title: "Test",
  icon: null,
  className: "min-h-10",
  errorDescription: "Could not load.",
};

// The widget cache is process-global and keyed by id, and every widget here shares one id.
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
