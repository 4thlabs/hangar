"use client";

import { RotateCcwIcon, XIcon } from "lucide-react";
import type { JobData, JobState } from "sidequest";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { LocalDateTime } from "#modules/common/components/local-date-time.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";

/** Only these can still be stopped; the others already reached a final state. */
const cancellable: JobState[] = ["waiting", "claimed", "running"];

const endedAt = (job: JobData) => job.completed_at ?? job.failed_at ?? job.canceled_at;

type JobsSettingsCardProps = {
  jobs: JobData[];
  runJob: (id: number) => Promise<ActionResult>;
  cancelJob: (id: number) => Promise<ActionResult>;
};

export function JobsSettingsCard({ jobs, runJob, cancelJob }: JobsSettingsCardProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(SettingsMessages);

  const handle = (action: () => Promise<ActionResult>, error: string) =>
    run(action, { success: t("jobs.done"), error }, () => router.reload());

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("jobs.title")}</CardTitle>
        <CardDescription>{t("jobs.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("jobs.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("jobs.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("jobs.columns.job")}</TableHead>
                <TableHead>{t("jobs.columns.queue")}</TableHead>
                <TableHead>{t("jobs.columns.state")}</TableHead>
                <TableHead>{t("jobs.columns.attempts")}</TableHead>
                <TableHead>{t("jobs.columns.created")}</TableHead>
                <TableHead>{t("jobs.columns.ended")}</TableHead>
                <TableHead>{t("jobs.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map(job => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.class}</TableCell>
                  <TableCell>{job.queue}</TableCell>
                  <TableCell>
                    <Badge variant={job.state === "failed" ? "destructive" : "secondary"}>
                      {t(`jobs.states.${job.state}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {job.attempt} / {job.max_attempts}
                  </TableCell>
                  <TableCell>
                    <LocalDateTime value={job.inserted_at} />
                  </TableCell>
                  <TableCell>
                    <LocalDateTime value={endedAt(job)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        title={t("jobs.rerun")}
                        aria-label={t("jobs.rerunLabel")}
                        disabled={isPending}
                        onClick={() => handle(() => runJob(job.id), t("jobs.rerunFailed"))}
                      >
                        <RotateCcwIcon />
                      </Button>
                      {cancellable.includes(job.state) && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          title={t("jobs.cancel")}
                          aria-label={t("jobs.cancelLabel")}
                          disabled={isPending}
                          onClick={() => handle(() => cancelJob(job.id), t("jobs.cancelFailed"))}
                        >
                          <XIcon />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
