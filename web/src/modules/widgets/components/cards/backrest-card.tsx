import { cn } from "cn";
import type { BackrestHealth, BackrestSummary } from "#libs/api";
import { compactRelativeTime } from "#libs/format";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { LoadedWidget } from "#modules/widgets/components/loaded-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatBytes } from "#modules/widgets/helpers/widget-format.ts";
import { m } from "#paraglide/messages.js";

/** `backrest-summary`: Backrest's repositories and their last backups. */
export const backrestWidget = defineWidget("backrest-summary", {
  icon: WidgetIcon.dashboard("backrest"),
  className: "min-h-40",
  title: m.widgets_backrest_summary_title,
  errorDescription: m.widgets_backrest_summary_error_description,
  card: BackrestWidget,
});

/** The card, with what it loaded of `GET /widgets/{key}`, in its own region. */
function BackrestWidget({ placement }: WidgetProps) {
  return (
    <LoadedWidget placement={placement} type="backrest-summary" look={widgetLook(backrestWidget)}>
      {summary => <BackrestCard summary={summary} link={placement.link} />}
    </LoadedWidget>
  );
}

/** The dot of a repository: muted for one that has not run, which is neither healthy nor failed. */
const healthDotClasses: Readonly<Record<BackrestHealth, string>> = {
  never_run: "bg-muted-foreground",
  healthy: "bg-primary",
  failed: "bg-destructive",
};

type BackrestCardProps = {
  summary: BackrestSummary;
  link: string | null;
};

/** Each repository of Backrest's, and how its last backup went. */
export function BackrestCard({ summary: { repositories }, link }: BackrestCardProps) {
  const now = useNow();
  const look = widgetLook(backrestWidget);
  const protectedBytes = repositories.reduce((total, repository) => total + repository.protectedBytes, 0);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_counts_repos({ count: repositories.length })}</span>
            <span>{m.widgets_backrest_protected({ size: formatBytes(protectedBytes) })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty={m.widgets_backrest_empty()}>
          {repositories.map(repository => (
            <WidgetListItem
              key={repository.id}
              className="items-start"
              media={
                // Decorative: the status word below says the same.
                <span
                  aria-hidden="true"
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", healthDotClasses[repository.health])}
                />
              }
              trailing={
                repository.lastRunAt && <WidgetTime at={Date.parse(repository.lastRunAt)} now={now} variant="compact" />
              }
            >
              <p className="truncate font-medium text-primary">{repository.id}</p>

              {/* Wraps rather than truncating, so a narrow column loses nothing. */}
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <WidgetMetadata>
                  <span className={repository.health === "failed" ? "text-destructive" : undefined}>
                    {repository.status ?? m.widgets_backrest_no_backup()}
                  </span>
                  <span>{m.widgets_backrest_successes({ count: repository.successes })}</span>
                  <span>{m.widgets_backrest_added({ size: formatBytes(repository.bytesAdded) })}</span>
                  <span>{m.widgets_backrest_protected({ size: formatBytes(repository.protectedBytes) })}</span>
                  {repository.nextBackupAt && (
                    <span>
                      {m.widgets_backrest_next({ when: compactRelativeTime(Date.parse(repository.nextBackupAt), now) })}
                    </span>
                  )}
                </WidgetMetadata>
              </p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}
