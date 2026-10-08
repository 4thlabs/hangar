import type { WidgetBody } from "../shared/define-widget.tsx";
import { WidgetCard, WidgetContent, WidgetHeader, WidgetList, WidgetListItem, WidgetTime } from "../shared/index.ts";
import { githubClient, type GithubRelease } from "./api/client.ts";
import { githubReleasesDescriptor } from "./descriptor.ts";

const { appearance } = githubReleasesDescriptor;

type GithubReleasesCardProps = {
  releases: GithubRelease[];
  now?: number;
};

export function GithubReleasesCard({ releases, now = Date.now() }: GithubReleasesCardProps) {
  return (
    <WidgetCard>
      <WidgetHeader icon={appearance.icon} title={appearance.title} bordered={releases.length > 0} />

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
export const githubReleases = (repositories: readonly string[]): WidgetBody<GithubRelease[]> => ({
  load: () => githubClient.getLatestReleases(repositories),
  render: releases => <GithubReleasesCard releases={releases} />,
});
