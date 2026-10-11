"use client";

import { RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "waku";
import { readStackTasks, redeployStack, removeStack, type StackTask } from "#modules/cluster/actions/manage-stacks.ts";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#modules/common/ui/alert-dialog.tsx";
import { Alert, AlertDescription } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#modules/common/ui/sheet.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
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
  const [tasks, setTasks] = useState<StackTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const operation = useServerAction();

  function load(name: string) {
    startLoading(async () => {
      try {
        const result = await readStackTasks(name);

        setTasks(result.tasks ?? null);
        setError(result.success ? null : result.message);
      } catch (cause) {
        console.error("Server action failed", cause);
        setError("Impossible de contacter le serveur.");
      }
    });
  }

  useEffect(() => {
    setTasks(null);
    setError(null);

    if (stack) {
      load(stack);
    }
  }, [stack]);

  function redeploy(name: string) {
    operation.run(
      () => redeployStack(name),
      { success: "Stack redéployée", error: "Échec du déploiement" },
      async () => {
        load(name);
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
            <Button type="button" size="sm" variant="outline" disabled={isLoading} onClick={() => stack && load(stack)}>
              {isLoading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              Actualiser
            </Button>
            {manageable && (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={operation.isPending}
                  onClick={() => stack && redeploy(stack)}
                  title="docker stack deploy"
                >
                  {operation.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
                  Mettre à jour
                </Button>
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

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {tasks && <TaskTable tasks={tasks} />}
        </div>
      </SheetContent>

      <AlertDialog open={confirmingRemoval} onOpenChange={setConfirmingRemoval}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {stack} du swarm ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ses services sont arrêtés sur tous les nœuds et l’app est retirée de la liste swarm de hangar.yml. Elle
              reste installée et ses volumes sont conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => stack && remove(stack)}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/** One row per task, the failed ones with Docker's reason. */
function TaskTable({ tasks }: { tasks: StackTask[] }) {
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
          <TableRow key={task.ID}>
            <TableCell className="font-medium">{task.Name}</TableCell>
            <TableCell>{task.Node}</TableCell>
            <TableCell>{task.CurrentState}</TableCell>
            <TableCell className="max-w-64 whitespace-normal text-destructive">{task.Error}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
