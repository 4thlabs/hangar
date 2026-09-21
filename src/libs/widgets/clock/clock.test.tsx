import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWidgetCache } from "../mock/index.ts";
import { ClockDisplay } from "./clock-display.tsx";
import { clockWidget } from "./clock.tsx";

beforeEach(clearWidgetCache);

describe("clockWidget", () => {
  it("renders the date and time of the moment it is rendered", async () => {
    const html = renderToStaticMarkup(await clockWidget.Widget());
    const now = new Date();

    expect(html).toContain(`>${now.getDate()}</span>`);
    expect(html).toContain(`>${now.getFullYear()}</p>`);
    expect(html).toContain("font-mono");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const html = renderToStaticMarkup(<clockWidget.Skeleton />);

    expect(html).toContain("Clock");
    expect(html).toContain('aria-busy="true"');
  });

  it("takes its size from the definition, so the card and the skeleton match", () => {
    expect(renderToStaticMarkup(<ClockDisplay className="h-20" />)).toContain("h-20");
    expect(renderToStaticMarkup(<clockWidget.Skeleton />)).toContain("h-20");
  });
});
