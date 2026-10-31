import { cn } from "cn";
import { Translation } from "#libs/i18n";
import { logger } from "#libs/logs";
import type { LocaleCode } from "#libs/preferences";
import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../shared/index.ts";
import { ForgejoClient, type ForgejoRepository, type ForgejoRun } from "./api/client.ts";
import { forgejoCiDescriptor } from "./descriptor.ts";
import { ForgejoMessages } from "./messages.ts";

const { appearance } = forgejoCiDescriptor;

/** What the card shows: how many repositories there are, what CI is busy with, and what changed last. */
export type ForgejoCiSummary = {
  repositoryCount: number;
  /** Every run not finished yet, running ones first, then newest first. */
  activeRuns: ForgejoRun[];
  /** The repositories updated last, newest first. */
  recentRepositories: ForgejoRepository[];
};

/** Turns the repositories and their active runs into what the card shows. */
export class ForgejoCi {
  /** How many recently updated repositories the card lists. */
  private static readonly RecentCount = 3;

  /** Archived and empty repositories run nothing, and one without the Actions unit has no runs to list. */
  static runsActions(repository: ForgejoRepository) {
    return repository.has_actions && !repository.archived && !repository.empty;
  }

  /** The summary of every repository and of the active runs found in them. */
  static summarize(repositories: ForgejoRepository[], activeRuns: ForgejoRun[]): ForgejoCiSummary {
    const byNewest = (a: string, b: string) => Date.parse(b) - Date.parse(a);

    const runningFirst = (a: ForgejoRun, b: ForgejoRun) =>
      Number(ForgejoCi.isQueued(a)) - Number(ForgejoCi.isQueued(b)) || byNewest(a.created, b.created);

    return {
      repositoryCount: repositories.length,
      activeRuns: activeRuns.toSorted(runningFirst),
      // Archiving bumps `updated_at` too, and an archived repository is not where the work is.
      recentRepositories: repositories
        .filter(repository => !repository.archived)
        .toSorted((a, b) => byNewest(a.updated_at, b.updated_at))
        .slice(0, ForgejoCi.RecentCount),
    };
  }

  /** An active run waiting for a runner or an approval, rather than running. */
  static isQueued(run: ForgejoRun) {
    return run.status !== "running";
  }

  /** When a run started; until it does, when it was queued. */
  static moment(run: ForgejoRun) {
    const startedAt = Date.parse(run.started);

    // Go's zero time, for a moment that has not happened, parses to year 1.
    return startedAt > 0 ? startedAt : Date.parse(run.created);
  }

  /**
   * `load` over every item, merged. An item that fails is skipped and logged, so one private account or broken
   * repository cannot take the card down; when they all fail, the card does.
   * @param describe What the log says the failed item was
   */
  static async settle<Item, Value>(
    items: readonly Item[],
    load: (item: Item) => Promise<Value[]>,
    describe: (item: Item) => Record<string, string>,
  ): Promise<Value[]> {
    const settled = await Promise.allSettled(items.map(load));
    const values: Value[] = [];
    const failures: unknown[] = [];

    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") {
        values.push(...result.value);
      } else {
        failures.push(result.reason);
        logger.warn("Skipping part of the Forgejo card", { error: result.reason, ...describe(items[index]!) });
      }
    }

    if (failures.length > 0 && failures.length === settled.length) {
      throw new AggregateError(failures, "Forgejo answered none of the requests");
    }

    return values;
  }
}

type ForgejoCiCardProps = {
  summary: ForgejoCiSummary;
  serviceUrl: string;
  locale: LocaleCode;
  now?: number;
};

export function ForgejoCiCard({ summary, serviceUrl, locale, now = Date.now() }: ForgejoCiCardProps) {
  const t = Translation.create(ForgejoMessages, locale);
  const { repositoryCount, activeRuns, recentRepositories } = summary;
  const queued = activeRuns.filter(run => ForgejoCi.isQueued(run)).length;
  const running = activeRuns.length - queued;

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={t("title")}
        description={
          <WidgetMetadata>
            <span>{t("repos", { count: repositoryCount })}</span>
            {running > 0 && <span className="font-medium text-chart-4">{t("running", { count: running })}</span>}
            {queued > 0 && <span>{t("queued", { count: queued })}</span>}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty={t("empty")}>
          {activeRuns.map(run => (
            <WidgetListItem
              key={run.id}
              className="items-start"
              media={
                // Decorative: the status word below says the same.
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    ForgejoCi.isQueued(run) ? "bg-muted-foreground" : "animate-pulse bg-chart-4",
                  )}
                />
              }
              trailing={<WidgetTime style="compact" at={ForgejoCi.moment(run)} now={now} locale={locale} />}
            >
              <a
                href={run.html_url}
                target="_blank"
                rel="noreferrer"
                title={run.title}
                className="block truncate font-medium text-primary hover:underline"
              >
                {run.repository.full_name}
              </a>
              <p className="truncate text-xs text-muted-foreground">
                <WidgetMetadata>
                  <span>{run.status}</span>
                  <span>{run.prettyref}</span>
                  <span>{run.title}</span>
                </WidgetMetadata>
              </p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>

      {recentRepositories.length > 0 && (
        <WidgetFooter title={t("recent")}>
          <WidgetList className="w-full gap-2">
            {recentRepositories.map(repository => (
              <WidgetListItem
                key={repository.full_name}
                trailing={
                  <WidgetTime style="compact" at={Date.parse(repository.updated_at)} now={now} locale={locale} />
                }
              >
                <a
                  href={repository.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm hover:underline"
                >
                  {repository.full_name}
                </a>
              </WidgetListItem>
            ))}
          </WidgetList>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}

/**
 * What Forgejo Actions is running or has queued, and the repositories updated last.
 * @param owners The users and organizations to cover; absent, every repository the key can see
 */
export const forgejoCi = (service: WidgetService, owners?: readonly string[]): WidgetBody<ForgejoCiSummary> => ({
  load: async () => {
    const client = await ForgejoClient.connect(service);

    const repositories =
      owners === undefined
        ? await client.getRepositories()
        : await ForgejoCi.settle(
            owners,
            owner => client.getOwnerRepositories(owner),
            owner => ({ owner }),
          );

    // Forgejo has no instance-wide list of runs: each repository is asked for its own.
    const activeRuns = await ForgejoCi.settle(
      repositories.filter(ForgejoCi.runsActions),
      repository => client.getActiveRuns(repository.full_name),
      repository => ({ repository: repository.full_name }),
    );

    return ForgejoCi.summarize(repositories, activeRuns);
  },
  render: (summary, _placementKey, locale) => (
    <ForgejoCiCard summary={summary} serviceUrl={service.link} locale={locale} />
  ),
});
