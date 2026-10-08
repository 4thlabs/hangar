import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WidgetIcon } from "../config/config.ts";
import { WidgetIconImage } from "./widget-icon.tsx";

describe("WidgetIconImage", () => {
  it("draws an icon without a dark variant once, on every theme", () => {
    const html = renderToStaticMarkup(<WidgetIconImage icon={WidgetIcon.dashboard("docker")} />);

    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain("dashboard-icons/svg/docker.svg");
  });

  it("swaps an icon for its dark variant on a dark theme", () => {
    const html = renderToStaticMarkup(<WidgetIconImage icon={WidgetIcon.dashboard("github", "github-light")} />);

    expect(html).toMatch(/src="[^"]*\/github\.svg"[^>]*class="[^"]*dark:hidden/);
    expect(html).toMatch(/src="[^"]*\/github-light\.svg"[^>]*class="[^"]*hidden[^"]*dark:block/);
  });
});
