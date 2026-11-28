import { describe, expect, it } from "vitest";
import type { GithubRelease } from "#libs/api";
import { githubView } from "./github-view.ts";

function release(repository: string, publishedAt: string): GithubRelease {
  return { repository, tag: "v1", url: `https://github.com/${repository}/releases/tag/v1`, publishedAt };
}

describe("githubView", () => {
  it("lists the releases newest first, whatever the order of hangar.yml", () => {
    const view = githubView([
      release("4thlabs/hangar", "2026-11-20T10:00:00Z"),
      release("glanceapp/glance", "2026-11-25T10:00:00Z"),
    ]);

    expect(view.map(found => found.repository)).toEqual(["glanceapp/glance", "4thlabs/hangar"]);
  });
});
