import type { GithubRelease } from "./api/client.ts";
import { getLatestReleases } from "./api/client.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import { WidgetCard, WidgetContent, WidgetHeader, WidgetList, WidgetListItem, WidgetTime } from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type GithubReleasesCardProps = {
  releases: GithubRelease[];
  now?: number;
};

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
const chrome = { title: "Releases", icon: <IconSelfh name="github" /> };

export function GithubReleasesCard({ releases, now = Date.now() }: GithubReleasesCardProps) {
  return (
    <WidgetCard>
      <WidgetHeader icon={chrome.icon} title={chrome.title} bordered={releases.length > 0} />

      <WidgetContent>
        <WidgetList empty="No releases found.">
          {releases.map(release => (
            <WidgetListItem
              key={release.repository}
              trailing={<WidgetTime at={Date.parse(release.publishedAt)} now={now} />}
            >
              <a
                href={release.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-medium text-primary hover:underline"
              >
                {release.repository}
              </a>
              <p className="truncate text-xs tabular-nums text-muted-foreground">{release.tag}</p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}

/** The latest release of each watched repository, newest first. */
export const githubReleases = (repositories: readonly string[], ttl?: number) =>
  defineWidget({
    id: "github-releases",
    ttl,
    ...chrome,
    errorDescription: "The GitHub releases could not be loaded.",
    load: () => getLatestReleases(repositories),
    render: (releases: GithubRelease[]) => <GithubReleasesCard releases={releases} />,
  });
