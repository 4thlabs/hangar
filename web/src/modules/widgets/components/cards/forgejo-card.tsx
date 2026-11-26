import { cn } from "cn";
import type { ForgejoCi } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { widgetLook } from "#modules/widgets/widget-appearance.ts";
import { formatCount, formatInteger } from "#modules/widgets/widget-format.ts";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../widget.tsx";

type ForgejoCardProps = {
  ci: ForgejoCi;
  link: string | null;
};

/** What Forgejo Actions runs or has queued, and the repositories updated last. */
export function ForgejoCard({ ci: { repositoryCount, activeRuns, recentRepositories }, link }: ForgejoCardProps) {
  const now = useNow();
  const look = widgetLook("forgejo-ci");
  const queued = activeRuns.filter(run => run.isQueued).length;
  const running = activeRuns.length - queued;

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{formatCount(repositoryCount, "repo", "repos")}</span>
            {running > 0 && <span className="font-medium text-chart-4">{formatInteger(running)} running</span>}
            {queued > 0 && <span>{formatInteger(queued)} queued</span>}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="Nothing running.">
          {activeRuns.map(run => (
            <WidgetListItem
              key={`${run.repository}-${run.id}`}
              className="items-start"
              media={
                // Decorative: the status word below says the same.
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    run.isQueued ? "bg-muted-foreground" : "animate-pulse bg-chart-4",
                  )}
                />
              }
              trailing={<WidgetTime at={Date.parse(run.since)} now={now} variant="compact" />}
            >
              <a
                href={run.url}
                target="_blank"
                rel="noreferrer"
                title={run.title}
                className="block truncate font-medium text-primary hover:underline"
              >
                {run.repository}
              </a>
              <p className="truncate text-xs text-muted-foreground">
                <WidgetMetadata>
                  <span>{run.status}</span>
                  <span>{run.reference}</span>
                  <span>{run.title}</span>
                </WidgetMetadata>
              </p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>

      {recentRepositories.length > 0 && (
        <WidgetFooter title="Recently updated">
          <WidgetList className="w-full gap-2">
            {recentRepositories.map(repository => (
              <WidgetListItem
                key={repository.fullName}
                trailing={<WidgetTime at={Date.parse(repository.updatedAt)} now={now} variant="compact" />}
              >
                <a
                  href={repository.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm hover:underline"
                >
                  {repository.fullName}
                </a>
              </WidgetListItem>
            ))}
          </WidgetList>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}
