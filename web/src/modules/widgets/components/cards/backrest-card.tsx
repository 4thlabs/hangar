import { cn } from "cn";
import type { BackrestHealth, BackrestSummary } from "#libs/api";
import { compactRelativeTime } from "#libs/format";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatBytes, formatCount, formatInteger } from "#modules/widgets/helpers/widget-format.ts";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../widget.tsx";

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
            <span>{formatCount(repositories.length, "repo", "repos")}</span>
            <span>{formatBytes(protectedBytes)} protected</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="No repositories configured.">
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
                    {repository.status ?? "No backup yet"}
                  </span>
                  <span>{formatInteger(repository.successes)} ok / 30d</span>
                  <span>{formatBytes(repository.bytesAdded)} added</span>
                  <span>{formatBytes(repository.protectedBytes)} protected</span>
                  {repository.nextBackupAt && (
                    <span>next {compactRelativeTime(Date.parse(repository.nextBackupAt), now)}</span>
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
