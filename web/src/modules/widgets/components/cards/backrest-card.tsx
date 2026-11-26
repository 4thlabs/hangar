import { cn } from "cn";
import type { BackrestHealth, BackrestSummary } from "#libs/api";
import { RelativeTime } from "#libs/format";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
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
class HealthDot {
  static readonly ClassNames: Readonly<Record<BackrestHealth, string>> = {
    never_run: "bg-muted-foreground",
    healthy: "bg-primary",
    failed: "bg-destructive",
  };
}

type BackrestCardProps = {
  summary: BackrestSummary;
  link: string | null;
};

/** Each repository of Backrest's, and how its last backup went. */
export function BackrestCard({ summary: { repositories }, link }: BackrestCardProps) {
  const now = useNow();
  const look = WidgetAppearance.get("backrest-summary");
  const protectedBytes = repositories.reduce((total, repository) => total + repository.protectedBytes, 0);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{Units.count(repositories.length, "repo", "repos")}</span>
            <span>{Units.bytes(protectedBytes)} protected</span>
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
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", HealthDot.ClassNames[repository.health])}
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
                  <span>{Units.integer(repository.successes)} ok / 30d</span>
                  <span>{Units.bytes(repository.bytesAdded)} added</span>
                  <span>{Units.bytes(repository.protectedBytes)} protected</span>
                  {repository.nextBackupAt && (
                    <span>next {RelativeTime.compact(Date.parse(repository.nextBackupAt), now)}</span>
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
