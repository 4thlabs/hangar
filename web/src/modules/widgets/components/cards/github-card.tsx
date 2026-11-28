import type { GithubReleases } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { LoadedWidget } from "#modules/widgets/components/loaded-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";

/** `github-releases`: the latest release of GitHub repositories. */
export const githubWidget = defineWidget("github-releases", {
  icon: WidgetIcon.dashboard("github", "github-light"),
  title: m.widgets_github_releases_title,
  errorDescription: m.widgets_github_releases_error_description,
  card: GithubWidget,
});

/** The card, with what it loaded of `GET /widgets/{key}`, in its own region. */
function GithubWidget({ placement }: WidgetProps) {
  return (
    <LoadedWidget placement={placement} type="github-releases" look={widgetLook(githubWidget)}>
      {releases => <GithubCard releases={releases} />}
    </LoadedWidget>
  );
}

/** The latest release of each repository, newest first. */
export function GithubCard({ releases: { releases } }: { releases: GithubReleases }) {
  const now = useNow();
  const look = widgetLook(githubWidget);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader icon={look.icon} title={look.title} bordered={releases.length > 0} />

      <WidgetContent>
        <WidgetList empty={m.widgets_github_empty()}>
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
