import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WidgetIcon } from "../config/config.ts";
import { WidgetSkeleton } from "./widget-skeleton.tsx";

describe("WidgetSkeleton", () => {
  it("preserves the requested widget size without rendering a spinner", () => {
    const html = renderToStaticMarkup(
      <WidgetSkeleton className="min-h-64" icon={new WidgetIcon("/icon.svg")} title="Service" />,
    );

    expect(html).toContain("Service");
    expect(html).toContain("/icon.svg");
    expect(html).toContain("min-h-64");
    expect(html).toContain("w-full");
    expect(html).toContain("animate-pulse");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("border-b");
    expect(html).not.toContain("spinner");
  });
});
