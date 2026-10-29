import { describe, expect, it } from "vitest";
import { buildFileTree } from "./file-tree.ts";

describe("buildFileTree", () => {
  it("nests paths into folders, files before folders at each level", () => {
    const tree = buildFileTree(["config/nginx/site.conf", "miniflux.env", "config/settings.yml", "compose.yml"]);

    expect(tree).toEqual([
      { kind: "file", name: "compose.yml", path: "compose.yml" },
      { kind: "file", name: "miniflux.env", path: "miniflux.env" },
      {
        kind: "folder",
        name: "config",
        path: "config",
        children: [
          { kind: "file", name: "settings.yml", path: "config/settings.yml" },
          {
            kind: "folder",
            name: "nginx",
            path: "config/nginx",
            children: [{ kind: "file", name: "site.conf", path: "config/nginx/site.conf" }],
          },
        ],
      },
    ]);
  });

  it("is empty for an app without files", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});
