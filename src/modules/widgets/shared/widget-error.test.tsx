import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WidgetError } from "./widget-error.tsx";

describe("WidgetError", () => {
  it("renders a generic error while preserving the widget size class", () => {
    const html = renderToStaticMarkup(
      <WidgetError
        className="min-h-64"
        icon={<span aria-hidden="true">Icon</span>}
        name="Service"
        description="The widget could not be loaded."
      />,
    );

    expect(html).toContain("Service is unavailable");
    expect(html).toContain("The widget could not be loaded.");
    expect(html).toContain("min-h-64");
    expect(html).toContain('role="alert"');
  });
});
