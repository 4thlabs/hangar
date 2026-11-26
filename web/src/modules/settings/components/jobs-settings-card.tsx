import { useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { getJobsListQueryKey, useJobsCancel, useJobsList, useJobsRun, type JobRun } from "#libs/api";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/error-message.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";
import {
  askedAgainText,
  formatRunTime,
  isRunActive,
  jobName,
  jobsPollDelay,
  jobStateLabel,
  runFailure,
} from "#modules/settings/job-text.ts";

/**
 * The runs of the server's jobs, the last 50 it keeps in memory, the newest first: each can be run again, and one that
 * waits or runs canceled. The card reads them again each second while one waits or runs, and every 30 seconds
 * otherwise, so that a run a cron asks for shows.
 */
export function JobsSettingsCard() {
  const queryClient = useQueryClient();

  const { data: runs, error } = useJobsList({
    query: {
      refetchInterval: query => jobsPollDelay(query.state.data ?? []),
    },
  });

  const readAgain = () => void queryClient.invalidateQueries({ queryKey: getJobsListQueryKey() });

  // Read again whatever the outcome: a run refused, as one that ended, has changed since the list was read.
  const runAgain = useJobsRun({
    mutation: {
      onSuccess: asked => toastSuccess("Job asked for again", askedAgainText(asked)),
      onError: failure => toastFailure("Run again failed", failure),
      onSettled: readAgain,
    },
  });

  const cancel = useJobsCancel({
    mutation: {
      onSuccess: canceled => toastSuccess("Job canceled", `${jobName(canceled.job)} stops.`),
      onError: failure => toastFailure("Cancel failed", failure),
      onSettled: readAgain,
    },
  });

  const isPending = runAgain.isPending || cancel.isPending;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>JOBS</CardTitle>
        <CardDescription>
          The last 50 runs of the server's jobs: the image check, every four hours and as the server starts, and the
          update of the apps, every night.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{describeError(error)}</p>}
        {runs && runs.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No jobs</EmptyTitle>
              <EmptyDescription>No job has run since the server started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {runs && runs.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead>Actions</TableHead>
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
      </CardContent>
    </Card>
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
            title="Run again"
            aria-label={`Run the ${name.toLowerCase()} again`}
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
              title="Cancel"
              aria-label={`Cancel the ${name.toLowerCase()}`}
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
