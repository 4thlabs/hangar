import { cn } from "cn";
import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  RelativeTime,
  Units,
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../shared/index.ts";
import { BackrestClient, type BackrestRepoSummary } from "./api/client.ts";
import { backrestSummaryDescriptor } from "./descriptor.ts";

const { appearance } = backrestSummaryDescriptor;

/** A repository that has never run, whose last run succeeded, or whose last run did not. */
type RepoHealth = "never-run" | "healthy" | "failed";

/** One repository, already resolved to what the card shows. */
export type RepoBackup = {
  id: string;
  /** The last run's outcome, without Backrest's `STATUS_` prefix. Absent until the repo has run. */
  status: string | undefined;
  health: RepoHealth;
  lastRunAt: number | undefined;
  successes: number;
  bytesAdded: number;
  protectedBytes: number;
  nextBackupAt: number | undefined;
};

/** A Connect `int64`, which arrives as a string and is absent when it would have been zero. */
const count = (value: string | undefined) => Number(value ?? 0);

/** The same, as a moment: a zero is Backrest saying "never", not midnight in 1970. */
const moment = (value: string | undefined) => (count(value) === 0 ? undefined : Number(value));

/** Only `STATUS_SUCCESS` counts as healthy, as on Backrest's own dashboard. */
function healthOf(status: string | undefined): RepoHealth {
  if (status === undefined) {
    return "never-run";
  }

  return status === "STATUS_SUCCESS" ? "healthy" : "failed";
}

/** What a repository looks like on the card. */
export function displayRepo(summary: BackrestRepoSummary): RepoBackup {
  const status = summary.recentBackups?.status?.[0];

  return {
    id: summary.id,
    status: status?.replace(/^STATUS_/, ""),
    health: healthOf(status),
    lastRunAt: moment(summary.recentBackups?.timestampMs?.[0]),
    successes: count(summary.backupsSuccessLast30days),
    bytesAdded: count(summary.bytesAddedLast30days),
    protectedBytes: count(summary.protectedBytes),
    nextBackupAt: moment(summary.nextBackupTimeMs),
  };
}

/** Muted for a repository that has not run, which is neither healthy nor failed. */
const HEALTH_DOT_CLASS: Record<RepoHealth, string> = {
  "never-run": "bg-muted-foreground",
  healthy: "bg-primary",
  failed: "bg-destructive",
};

type BackrestSummaryCardProps = {
  repos: RepoBackup[];
  serviceUrl: string;
  now?: number;
};

export function BackrestSummaryCard({ repos, serviceUrl, now = Date.now() }: BackrestSummaryCardProps) {
  const protectedBytes = repos.reduce((total, repo) => total + repo.protectedBytes, 0);

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            <span>
              {repos.length} {repos.length === 1 ? "repo" : "repos"}
            </span>
            <span>{Units.bytes(protectedBytes)} protected</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="No repositories configured.">
          {repos.map(repo => (
            <WidgetListItem
              key={repo.id}
              className="items-start"
              media={
                // Decorative: the status word below says the same.
                <span
                  aria-hidden="true"
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", HEALTH_DOT_CLASS[repo.health])}
                />
              }
              trailing={repo.lastRunAt !== undefined && <WidgetTime at={repo.lastRunAt} now={now} style="compact" />}
            >
              <p className="truncate font-medium text-primary">{repo.id}</p>

              {/* Wraps rather than truncating, so a narrow column loses nothing. */}
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <WidgetMetadata>
                  <span className={repo.health === "failed" ? "text-destructive" : undefined}>
                    {repo.status ?? "No backup yet"}
                  </span>
                  <span>{repo.successes} ok / 30d</span>
                  <span>{Units.bytes(repo.bytesAdded)} added</span>
                  <span>{Units.bytes(repo.protectedBytes)} protected</span>
                  {repo.nextBackupAt !== undefined && <span>next {RelativeTime.compact(repo.nextBackupAt, now)}</span>}
                </WidgetMetadata>
              </p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}

/** Per-repository backup health. Needs an explicit `link:`: the store's Traefik router for Backrest is `backup`. */
export const backrestSummary = (service: WidgetService): WidgetBody<RepoBackup[]> => ({
  load: async () => ((await (await BackrestClient.connect(service)).getSummary()).repoSummaries ?? []).map(displayRepo),
  render: repos => <BackrestSummaryCard repos={repos} serviceUrl={service.link} />,
});
