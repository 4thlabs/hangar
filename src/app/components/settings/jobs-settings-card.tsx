"use client";

import type { ActionResult } from "#app/actions/action-result.ts";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#app/components/ui/empty.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#app/components/ui/table.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";
import { RotateCcwIcon, XIcon } from "lucide-react";
import type { JobData, JobState } from "sidequest";
import { useRouter } from "waku";

const stateLabel: Record<JobState, string> = {
  waiting: "En attente",
  claimed: "Réservé",
  running: "En cours",
  completed: "Terminé",
  failed: "Échoué",
  canceled: "Annulé",
};

/** Only these can still be stopped; the others already reached a final state. */
const cancellable: JobState[] = ["waiting", "claimed", "running"];

const formatDate = (date: Date | null) => (date ? new Date(date).toLocaleString("fr-FR") : "—");

const endedAt = (job: JobData) => job.completed_at ?? job.failed_at ?? job.canceled_at;

type JobsSettingsCardProps = {
  jobs: JobData[];
  runJob: (id: number) => Promise<ActionResult>;
  cancelJob: (id: number) => Promise<ActionResult>;
};

export function JobsSettingsCard({ jobs, runJob, cancelJob }: JobsSettingsCardProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();

  const handle = (action: () => Promise<ActionResult>, error: string) =>
    run(action, { success: "Opération terminée", error }, () => router.reload());

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>JOBS</CardTitle>
        <CardDescription>Les 50 derniers jobs traités par Sidequest.</CardDescription>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Aucun job</EmptyTitle>
              <EmptyDescription>Aucun job n’a encore été mis en file.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Tentatives</TableHead>
                <TableHead>Créé</TableHead>
                <TableHead>Terminé</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map(job => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.class}</TableCell>
                  <TableCell>{job.queue}</TableCell>
                  <TableCell>
                    <Badge variant={job.state === "failed" ? "destructive" : "secondary"}>
                      {stateLabel[job.state]}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {job.attempt} / {job.max_attempts}
                  </TableCell>
                  <TableCell>{formatDate(job.inserted_at)}</TableCell>
                  <TableCell>{formatDate(endedAt(job))}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        title="Relancer"
                        aria-label="Relancer le job"
                        disabled={isPending}
                        onClick={() => handle(() => runJob(job.id), "Échec de la relance")}
                      >
                        <RotateCcwIcon />
                      </Button>
                      {cancellable.includes(job.state) && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          title="Annuler"
                          aria-label="Annuler le job"
                          disabled={isPending}
                          onClick={() => handle(() => cancelJob(job.id), "Échec de l’annulation")}
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
