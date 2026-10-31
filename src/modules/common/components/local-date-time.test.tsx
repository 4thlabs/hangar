import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "#modules/common/mock/locale-provider.tsx";
import { LocalDateTime } from "./local-date-time.tsx";

describe("LocalDateTime", () => {
  it("writes the moment in UTC on the server, saying so, for the browser to rewrite in its own zone", () => {
    const html = renderToStaticMarkup(<LocalDateTime value="2026-10-18T03:30:00.000Z" />);

    expect(html).toBe('<time dateTime="2026-10-18T03:30:00.000Z">10/18/2026, 03:30:00 AM UTC</time>');
  });

  it("writes the moment the way the reader's language does", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="fr">
        <LocalDateTime value="2026-10-18T03:30:00.000Z" />
      </LocaleProvider>,
    );

    expect(html).toBe('<time dateTime="2026-10-18T03:30:00.000Z">18/10/2026 03:30:00 UTC</time>');
  });

  it("writes a dash for no moment", () => {
    expect(renderToStaticMarkup(<LocalDateTime value={null} />)).toBe("—");
  });
});
