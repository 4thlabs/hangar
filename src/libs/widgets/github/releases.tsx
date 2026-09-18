import type { GithubRelease } from "./api/client.ts";
import { getLatestReleases } from "./api/client.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetEmptyState,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  formatRelativeTime,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type GithubReleasesCardProps = {
  releases: GithubRelease[];
  now?: number;
};

const githubIcon = <IconSelfh name="github" />;

export function GithubReleasesCard({ releases, now = Date.now() }: GithubReleasesCardProps) {
  return (
    <WidgetCard>
      <WidgetHeader icon={githubIcon} title="Releases" bordered={releases.length > 0} />

      <WidgetContent>
        {releases.length > 0 ? (
          <WidgetList>
            {releases.map(release => {
              const publishedAt = new Date(release.publishedAt);

              return (
                <WidgetListItem
                  key={release.repository}
                  trailing={
                    <time dateTime={release.publishedAt} className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(publishedAt.getTime(), now)}
                    </time>
                  }
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
              );
            })}
          </WidgetList>
        ) : (
          <WidgetEmptyState>No releases found.</WidgetEmptyState>
        )}
      </WidgetContent>
    </WidgetCard>
  );
}

/**
 * The latest release of each watched repository, newest first.
 *
 * Built per placement rather than exported as a singleton: the repositories come
 * from the `github-releases` entry in the store's `hangar.yml`.
 */
export const githubReleases = (repositories: readonly string[]) =>
  defineWidget({
    id: "github-releases",
    title: "Releases",
    icon: githubIcon,
    errorDescription: "The GitHub releases could not be loaded. The rest of the dashboard is still available.",
    load: () => getLatestReleases(repositories),
    render: (releases: GithubRelease[]) => <GithubReleasesCard releases={releases} />,
  });
