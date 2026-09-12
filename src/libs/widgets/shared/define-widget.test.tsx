import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defineWidget } from "./define-widget.tsx";

const base = {
  id: "test-widget",
  title: "Test",
  icon: null,
  className: "min-h-10",
  errorDescription: "Could not load. The rest of the dashboard is still available.",
};

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
