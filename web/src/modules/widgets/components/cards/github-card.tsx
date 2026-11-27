import type { GithubReleases } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { widgetsMessages } from "#modules/widgets/messages.ts";

/** The latest release of each repository, newest first. */
export function GithubCard({ releases: { releases } }: { releases: GithubReleases }) {
  const now = useNow();
  const look = widgetLook("github-releases");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader icon={look.icon} title={look.title} bordered={releases.length > 0} />

      <WidgetContent>
        <WidgetList empty={widgetsMessages.github.empty}>
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
