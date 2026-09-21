import { cn } from "cn";
import type { BackrestRepoSummary } from "./api/client.ts";
import { createBackrestClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
  formatBytes,
  formatCompactTime,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
const chrome = { title: "Backrest", icon: <IconSelfh name="backrest" />, className: "min-h-40" };

/** One repository, already resolved to what the card shows. */
export type RepoBackup = {
  id: string;
  /** The last run's outcome, without Backrest's `STATUS_` prefix. Absent until the repo has run. */
  status: string | undefined;
  ok: boolean;
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

/**
 * What a repository looks like on the card.
 *
 * `recentBackups` is a struct of parallel arrays, newest first, so index `0` is the last run — and
 * absent entirely for a repository that has never backed up. Only `STATUS_SUCCESS` counts as
 * healthy, which is the line Backrest's own dashboard and the Glance widget both draw.
 */
export function displayRepo(summary: BackrestRepoSummary): RepoBackup {
  const status = summary.recentBackups?.status?.[0];

  return {
    id: summary.id,
    status: status?.replace(/^STATUS_/, ""),
    ok: status === "STATUS_SUCCESS",
    lastRunAt: moment(summary.recentBackups?.timestampMs?.[0]),
    successes: count(summary.backupsSuccessLast30days),
    bytesAdded: count(summary.bytesAddedLast30days),
    protectedBytes: count(summary.protectedBytes),
    nextBackupAt: moment(summary.nextBackupTimeMs),
  };
}

type BackrestSummaryCardProps = {
  repos: RepoBackup[];
  serviceUrl: string;
  now?: number;
};

export function BackrestSummaryCard({ repos, serviceUrl, now = Date.now() }: BackrestSummaryCardProps) {
  const protectedBytes = repos.reduce((total, repo) => total + repo.protectedBytes, 0);

  return (
    <WidgetCard className={chrome.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={chrome.icon}
        title={chrome.title}
        description={
          <WidgetMetadata>
            <span>
              {repos.length} {repos.length === 1 ? "repo" : "repos"}
            </span>
            <span>{formatBytes(protectedBytes)} protected</span>
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
                // The dot repeats what the status word below already says: colour alone is never
                // the status. Muted for a repository that has not run, which is neither.
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    repo.status === undefined ? "bg-muted-foreground" : repo.ok ? "bg-primary" : "bg-destructive",
                  )}
                />
              }
              trailing={repo.lastRunAt !== undefined && <WidgetTime at={repo.lastRunAt} now={now} compact />}
            >
              <p className="truncate font-medium text-primary">{repo.id}</p>

              {/* One line, not two: everything a repository has to say fits beside everything
                  else once the clock is written `18h` instead of `18 hours ago`. It wraps rather
                  than truncating, so a narrow column loses nothing. */}
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <WidgetMetadata>
                  <span className={repo.status !== undefined && !repo.ok ? "text-destructive" : undefined}>
                    {repo.status ?? "No backup yet"}
                  </span>
                  <span>{repo.successes} ok / 30d</span>
                  <span>{formatBytes(repo.bytesAdded)} added</span>
                  <span>{formatBytes(repo.protectedBytes)} protected</span>
                  {repo.nextBackupAt !== undefined && <span>next {formatCompactTime(repo.nextBackupAt, now)}</span>}
                </WidgetMetadata>
              </p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}

/**
 * Per-repository backup health: the last run, how it went, and when the next one is due.
 *
 * The placement needs an explicit `link:`, unlike every other service widget here: the store gives
 * Backrest a Traefik router named `backup`, so the default `<container>.<DOMAIN>` guess —
 * `backrest.<DOMAIN>` — points at nothing. `url:` matters too, because the public host sits behind
 * the OIDC middleware while the container network answers straight away.
 */
export const backrestSummary = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "backrest-summary",
    ttl,
    ...chrome,
    errorDescription: "The backup status could not be loaded.",
    skeleton: { withSubtitle: true },
    load: async () => ((await (await createBackrestClient(service)).getSummary()).repoSummaries ?? []).map(displayRepo),
    render: (repos: RepoBackup[]) => <BackrestSummaryCard repos={repos} serviceUrl={service.link} />,
  });
