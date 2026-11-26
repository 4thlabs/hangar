import { describe, expect, it } from "vitest";
import { colorModes, themePalettes } from "./theme.ts";

describe("theme palettes", () => {
  // The tuple is the source of truth; a palette with no stylesheet renders unstyled.
  it("all have a stylesheet imported by styles.css", async () => {
    const styles = await import("node:fs/promises").then(fs => fs.readFile("src/styles.css", "utf8"));

    for (const { value } of themePalettes) {
      expect(styles, `theme-${value}.css is not imported by styles.css`).toContain(`./theme/theme-${value}.css`);
    }
  });
});

describe("theme color modes", () => {
  // index.html checks the cookie before the page runs, with a list of its own.
  it("are the ones index.html accepts before the first paint", async () => {
    const index = await import("node:fs/promises").then(fs => fs.readFile("index.html", "utf8"));

    expect(index).toContain(JSON.stringify(colorModes).replaceAll(",", ", "));
  });
});
