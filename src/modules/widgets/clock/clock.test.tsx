import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { aWidget, clearWidgetCache } from "../mock/index.ts";
import { clockWidget } from "./clock.tsx";
import { clockDescriptor } from "./descriptor.ts";

beforeEach(clearWidgetCache);

const clock = aWidget(clockDescriptor, clockWidget);

describe("clockWidget", () => {
  it("renders the date and time of the moment it is rendered", async () => {
    const html = renderToStaticMarkup(await clock.Widget());
    const now = new Date();

    expect(html).toContain(`>${now.getDate()}</span>`);
    expect(html).toContain(`>${now.getFullYear()}</p>`);
    expect(html).toContain("font-mono");
  });

  it("exposes a titled skeleton through its descriptor", () => {
    const html = renderToStaticMarkup(<clock.Skeleton />);

    expect(html).toContain("Clock");
    expect(html).toContain('aria-busy="true"');
  });

  it("takes its size from the descriptor, so the card and the skeleton match", async () => {
    expect(renderToStaticMarkup(await clock.Widget())).toContain("h-20");
    expect(renderToStaticMarkup(<clock.Skeleton />)).toContain("h-20");
  });
});
