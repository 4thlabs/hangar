import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GithubRelease } from "./api/client.ts";
import { GithubReleasesCard, githubReleases } from "./releases.tsx";

const now = Date.parse("2026-09-18T12:00:00Z");

const releases: GithubRelease[] = [
  {
    repository: "glanceapp/glance",
    tag: "v0.8.4",
    url: "https://github.com/glanceapp/glance/releases/tag/v0.8.4",
    publishedAt: "2026-09-18T10:00:00Z",
  },
  {
    repository: "immich-app/immich",
    tag: "v1.140.0",
    url: "https://github.com/immich-app/immich/releases/tag/v1.140.0",
    publishedAt: "2026-09-15T12:00:00Z",
  },
];

describe("GithubReleasesCard", () => {
  it("renders every release with its tag, age and link", () => {
    const html = renderToStaticMarkup(<GithubReleasesCard releases={releases} now={now} />);

    expect(html).toContain("glanceapp/glance");
    expect(html).toContain("v0.8.4");
    expect(html).toContain("https://github.com/glanceapp/glance/releases/tag/v0.8.4");
    expect(html).toContain("2 hours ago");
    expect(html).toContain("immich-app/immich");
    expect(html).toContain("v1.140.0");
    expect(html).toContain("3 days ago");
  });

  it("renders the empty state when no repository answered", () => {
    const html = renderToStaticMarkup(<GithubReleasesCard releases={[]} now={now} />);

    expect(html).toContain("No releases found.");
    expect(html).not.toContain("github.com");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = githubReleases(["glanceapp/glance"]);
    const html = renderToStaticMarkup(<Skeleton />);

    expect(html).toContain("Releases");
    expect(html).toContain('aria-busy="true"');
  });
});
