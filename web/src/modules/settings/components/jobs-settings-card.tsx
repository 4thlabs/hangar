import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcwIcon, XIcon } from "lucide-react";
import type { JobRun } from "#libs/api";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";
import { settingsMutations, settingsQueries } from "#modules/settings/api/settings-queries.ts";
import {
  askedAgainText,
  formatRunTime,
  isRunActive,
  jobName,
  jobStateLabel,
  runFailure,
} from "#modules/settings/helpers/job-text.ts";
import { m } from "#paraglide/messages.js";

/**
 * The runs of the server's jobs, the last 50 it keeps in memory, the newest first: each can be run again, and one that
 * waits or runs canceled. The card reads them again each second while one waits or runs, and every 30 seconds
 * otherwise, so that a run a cron asks for shows.
 */
export function JobsSettingsCard() {
  const jobs = useQuery(settingsQueries.jobs());

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{m.settings_jobs_title()}</CardTitle>
        <CardDescription>{m.settings_jobs_description()}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryRegion
          query={jobs}
          failure={m.settings_jobs_read_failed()}
          fallback={<Skeleton className="h-24 w-full" />}
        >
          {runs => <JobRuns runs={runs} error={jobs.error} />}
        </QueryRegion>
      </CardContent>
    </Card>
  );
}

type JobRunsProps = {
  runs: readonly JobRun[];
  /** Why the last read failed, when the runs shown are those of an earlier one. */
  error: Error | null;
};

/** The runs, once read, and their buttons; a read again that fails says so above the runs as they were. */
function JobRuns({ runs, error }: JobRunsProps) {
  // The options read the runs again whatever the outcome; the toasts are this card's.
  const runAgain = useMutation({
    ...settingsMutations.runJob(),
    onSuccess: asked => toastSuccess(m.settings_jobs_asked_again(), askedAgainText(asked)),
    onError: failure => toastFailure(m.settings_jobs_run_again_failed(), failure),
  });

  const cancel = useMutation({
    ...settingsMutations.cancelJob(),
    onSuccess: canceled =>
      toastSuccess(m.settings_jobs_canceled(), m.settings_jobs_stops({ job: jobName(canceled.job) })),
    onError: failure => toastFailure(m.settings_jobs_cancel_failed(), failure),
  });

  const isPending = runAgain.isPending || cancel.isPending;

  return (
    <>
      {error && <p className="text-sm text-destructive">{describeError(error)}</p>}
      {runs.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.settings_jobs_empty()}</EmptyTitle>
            <EmptyDescription>{m.settings_jobs_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {runs.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m.settings_columns_job()}</TableHead>
              <TableHead>{m.settings_columns_queue()}</TableHead>
              <TableHead>{m.settings_columns_state()}</TableHead>
              <TableHead>{m.settings_columns_created()}</TableHead>
              <TableHead>{m.settings_columns_ended()}</TableHead>
              <TableHead>{m.settings_columns_actions()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map(run => (
              <JobRow
                key={run.id}
                run={run}
                isPending={isPending}
                onRunAgain={() => runAgain.mutate({ id: run.id })}
                onCancel={() => cancel.mutate({ id: run.id })}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

type JobRowProps = {
  run: JobRun;
  /** Whether a run again or a cancel is under way, which the buttons wait for. */
  isPending: boolean;
  onRunAgain: () => void;
  onCancel: () => void;
};

/** A run: its job, its queue, its state and why it failed, its times, and its buttons. */
function JobRow({ run, isPending, onRunAgain, onCancel }: JobRowProps) {
  const name = jobName(run.job);
  const failure = runFailure(run);

  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell>{run.queue}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={run.state === "failed" ? "destructive" : "secondary"}>{jobStateLabel(run.state)}</Badge>
          {failure && <span className="text-xs whitespace-normal text-muted-foreground">{failure}</span>}
        </div>
      </TableCell>
      <TableCell>{formatRunTime(run.createdAt)}</TableCell>
      <TableCell>{formatRunTime(run.endedAt)}</TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            title={m.settings_jobs_run_again()}
            aria-label={m.settings_jobs_run_again_label({ job: run.job })}
            disabled={isPending}
            onClick={onRunAgain}
          >
            <RotateCcwIcon />
          </Button>
          {isRunActive(run) && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={m.settings_jobs_cancel()}
              aria-label={m.settings_jobs_cancel_label({ job: run.job })}
              disabled={isPending}
              onClick={onCancel}
            >
              <XIcon />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
