import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalDateTime } from "./local-date-time.tsx";

describe("LocalDateTime", () => {
  it("writes the moment in UTC on the server, saying so, for the browser to rewrite in its own zone", () => {
    const html = renderToStaticMarkup(<LocalDateTime value="2026-10-18T03:30:00.000Z" />);

    expect(html).toBe('<time dateTime="2026-10-18T03:30:00.000Z">18/10/2026 03:30:00 UTC</time>');
  });

  it("writes a dash for no moment", () => {
    expect(renderToStaticMarkup(<LocalDateTime value={null} />)).toBe("—");
  });
});
