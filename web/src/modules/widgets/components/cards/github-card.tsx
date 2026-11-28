import type { GithubRelease, ServicesGithubParams } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { servicesQueries } from "#modules/widgets/api/services-queries.ts";
import { ServiceWidget } from "#modules/widgets/components/service-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { githubView } from "#modules/widgets/helpers/github-view.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";

/** What the card reads of GitHub: the latest release of each repository. */
const releasesRead = { releases: true } as const satisfies ServicesGithubParams;

/** `github-releases`: the latest release of GitHub repositories. */
export const githubWidget = defineWidget("github-releases", {
  icon: WidgetIcon.dashboard("github", "github-light"),
  title: m.widgets_github_releases_title,
  errorDescription: m.widgets_github_releases_error_description,
  card: GithubWidget,
});

/** The card, read from its service in its own region. */
function GithubWidget({ placement }: WidgetProps) {
  const look = widgetLook(githubWidget);

  return (
    <ServiceWidget query={servicesQueries.github} placement={placement} read={releasesRead} look={look}>
      {({ releases }) => <GithubCard releases={githubView(releases)} />}
    </ServiceWidget>
  );
}

/** The latest release of each repository, newest first. */
export function GithubCard({ releases }: { releases: readonly GithubRelease[] }) {
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
