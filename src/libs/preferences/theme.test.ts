import { describe, expect, it } from "vitest";
import { Theme } from "./theme.ts";

describe("theme palettes", () => {
  // The tuple is the source of truth; a palette with no stylesheet renders unstyled.
  it("all have a stylesheet imported by styles.css", async () => {
    const styles = await import("node:fs/promises").then(fs => fs.readFile("src/app/styles.css", "utf8"));

    for (const { value } of Theme.Palettes) {
      expect(styles, `theme-${value}.css is not imported by styles.css`).toContain(`./theme/theme-${value}.css`);
    }
  });
});
