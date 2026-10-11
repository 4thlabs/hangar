"use client";

import { RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "waku";
import type { SwarmStackTask } from "#libs/docker";
import { RelativeTime } from "#libs/format";
import { readStackTasks, redeployStack, removeStack } from "#modules/cluster/actions/manage-stacks.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useServerRead } from "#modules/common/hooks/use-server-read.ts";
import { Alert, AlertDescription } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#modules/common/ui/sheet.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type StackSheetProps = {
  /** The stack to show, `null` keeping the sheet closed. */
  stack: string | null;
  /** Whether Hangar can deploy it again and remove it: a store app with a compose.swarm.yml. */
  manageable: boolean;
  onClose: () => void;
};

/** The tasks of one stack, per node, with the deploy and removal Hangar can do on its own apps. */
export function StackSheet({ stack, manageable, onClose }: StackSheetProps) {
  const router = useRouter();
  const tasks = useServerRead<SwarmStackTask[]>();
  const operation = useServerAction();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const { load, reset } = tasks;

  // Read afresh each time a stack opens, and forgotten when the sheet closes. Only `stack` drives it:
  // `load` and `reset` are new functions on every render.
  useEffect(() => {
    reset();

    if (stack) {
      load(() => readStackTasks(stack));
    }
  }, [stack]);

  function redeploy(name: string) {
    operation.run(
      () => redeployStack(name),
      { success: "Stack redéployée", error: "Échec du déploiement" },
      async () => {
        load(() => readStackTasks(name));
        await router.reload();
      },
    );
  }

  function remove(name: string) {
    setConfirmingRemoval(false);
    operation.run(
      () => removeStack(name),
      { success: "Stack retirée", error: "Échec du retrait" },
      async () => {
        onClose();
        await router.reload();
      },
    );
  }

  return (
    <Sheet open={stack !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{stack}</SheetTitle>
          <SheetDescription>Les tâches de la stack sur chaque nœud, avec les tentatives passées.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <PendingButton
              type="button"
              size="sm"
              variant="outline"
              pending={tasks.isLoading}
              pendingLabel="Actualiser"
              icon={<RefreshCwIcon data-icon="inline-start" />}
              onClick={() => stack && load(() => readStackTasks(stack))}
            >
              Actualiser
            </PendingButton>
            {manageable && (
              <>
                <PendingButton
                  type="button"
                  size="sm"
                  pending={operation.isPending}
                  pendingLabel="Mettre à jour"
                  icon={<UploadIcon data-icon="inline-start" />}
                  onClick={() => stack && redeploy(stack)}
                  title="docker stack deploy"
                >
                  Mettre à jour
                </PendingButton>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={operation.isPending}
                  onClick={() => setConfirmingRemoval(true)}
                  title="docker stack rm"
                >
                  <Trash2Icon data-icon="inline-start" />
                  Supprimer
                </Button>
              </>
            )}
          </div>

          {tasks.error && (
            <Alert variant="destructive">
              <AlertDescription>{tasks.error}</AlertDescription>
            </Alert>
          )}

          {tasks.value && <TaskTable tasks={tasks.value} />}
        </div>
      </SheetContent>

      <ConfirmDialog
        open={confirmingRemoval}
        title={`Supprimer ${stack} du swarm ?`}
        description="Ses services sont arrêtés sur tous les nœuds. L’app reste installée, ses volumes sont conservés, et si elle est listée sous swarm: dans hangar.yml, le prochain swarm deploy la relancera."
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => stack && remove(stack)}
        onCancel={() => setConfirmingRemoval(false)}
      />
    </Sheet>
  );
}

/** One row per task, the failed ones with Docker's reason. */
function TaskTable({ tasks }: { tasks: SwarmStackTask[] }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune tâche.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tâche</TableHead>
          <TableHead>Nœud</TableHead>
          <TableHead>État</TableHead>
          <TableHead>Erreur</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map(task => (
          <TableRow key={task.id}>
            <TableCell className="font-medium">{task.name}</TableCell>
            <TableCell>{task.node}</TableCell>
            <TableCell>
              {task.state}
              {task.since && (
                <span className="text-muted-foreground">
                  {" "}
                  · {RelativeTime.format(Date.parse(task.since), Date.now(), "fr")}
                </span>
              )}
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal text-destructive">{task.error}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
