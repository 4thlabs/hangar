import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppFileTree } from "./app-file-tree.tsx";

const PATHS = ["compose.yml", "config/settings.yml", "miniflux.env"];

const renderTree = (selectedPath: string, unsavedPaths: string[]) =>
  renderToStaticMarkup(
    <AppFileTree
      paths={PATHS}
      selectedPath={selectedPath}
      unsavedPaths={new Set(unsavedPaths)}
      onSelect={() => {}}
      onCreate={() => {}}
      isCreating={false}
    />,
  );

/** The tree's file and folder rows, in display order, without the mobile toggle above them. */
const rowLabels = (html: string) =>
  [...html.matchAll(/<li><button[^>]*>.*?<span class="truncate">([^<]+)<\/span>/g)].map(match => match[1]);

describe("AppFileTree", () => {
  it("lists the files before the folders, a nested file under its expanded folder", () => {
    const html = renderTree("compose.yml", []);

    expect(rowLabels(html)).toEqual(["compose.yml", "miniflux.env", "config/", "settings.yml"]);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("New file");
  });

  it("marks the open file and the unsaved ones", () => {
    const html = renderTree("config/settings.yml", ["miniflux.env"]);

    expect(html).toMatch(/aria-current="page"[^>]*>.*?settings\.yml/);
    expect(html.match(/unsaved changes/g)).toHaveLength(1);
    expect(html).toMatch(/miniflux\.env<\/span><span[^>]*aria-label="unsaved changes"/);
  });

  it("renders one tree, folded behind a toggle below md rather than duplicated", () => {
    const html = renderTree("compose.yml", []);

    expect(html.match(/<ul/g)).toHaveLength(2);
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*?compose\.yml/);
    expect(html).toContain("hidden md:flex");
  });
});
