import { cn } from "cn";
import type { BackrestHealth, BackrestSummary } from "#libs/api";
import { compactRelativeTime } from "#libs/format";
import { useNow } from "#modules/common/hooks/use-now.ts";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatBytes } from "#modules/widgets/helpers/widget-format.ts";
import { widgetsMessages } from "#modules/widgets/messages.ts";

const words = widgetsMessages.backrest;

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
  const look = widgetLook("backrest-summary");
  const protectedBytes = repositories.reduce((total, repository) => total + repository.protectedBytes, 0);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{widgetsMessages.counts.repos({ count: repositories.length })}</span>
            <span>{words.protected({ size: formatBytes(protectedBytes) })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty={words.empty}>
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
                    {repository.status ?? words.noBackup}
                  </span>
                  <span>{words.successes({ count: repository.successes })}</span>
                  <span>{words.added({ size: formatBytes(repository.bytesAdded) })}</span>
                  <span>{words.protected({ size: formatBytes(repository.protectedBytes) })}</span>
                  {repository.nextBackupAt && (
                    <span>{words.next({ when: compactRelativeTime(Date.parse(repository.nextBackupAt), now) })}</span>
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
