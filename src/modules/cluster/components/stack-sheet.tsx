"use client";

import { RefreshCwIcon, RocketIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "waku";
import type { SwarmStackTask } from "#libs/docker";
import { RelativeTime } from "#libs/format";
import { Locale } from "#libs/preferences";
import { EditAppLink } from "#modules/apps/components/edit-app-link.tsx";
import { readStackTasks, removeStack } from "#modules/cluster/actions/manage-stacks.ts";
import { StackDeployOutput } from "#modules/cluster/components/stack-deploy-output.tsx";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { LogsSheet } from "#modules/common/components/logs-sheet.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useServerRead } from "#modules/common/hooks/use-server-read.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Alert, AlertDescription } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#modules/common/ui/sheet.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type StackSheetProps = {
  /** The stack to show, `null` keeping the sheet closed. */
  stack: string | null;
  /** Whether Hangar can deploy it and remove it: an installed store app with a compose.swarm.yml. */
  manageable: boolean;
  /** Whether the swarm runs it; an undeployed one has no task to show, only its deploy. */
  deployed: boolean;
  onClose: () => void;
};

/** The tasks of one stack, per node, with the deploy and removal Hangar can do on its own apps. */
export function StackSheet({ stack, manageable, deployed, onClose }: StackSheetProps) {
  const router = useRouter();
  const { t } = useTranslation(ClusterMessages);
  const tasks = useServerRead<SwarmStackTask[]>();
  const operation = useServerAction();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // Bumped by each deploy: its output remounts, which runs the deploy again. Zero shows none.
  const [deployRun, setDeployRun] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const { load, reset } = tasks;
  const deployLabel = deployed ? t("sheet.update") : t("sheet.deploy");
  const DeployIcon = deployed ? UploadIcon : RocketIcon;

  // Another stack, or a closed sheet, shows no earlier deploy.
  useEffect(() => {
    setDeployRun(0);
    setDeploying(false);
  }, [stack]);

  // Read afresh each time a stack opens or gets deployed, and forgotten when the sheet closes. `load`
  // and `reset` are new functions on every render.
  useEffect(() => {
    reset();

    if (stack && deployed) {
      load(() => readStackTasks(stack));
    }
  }, [stack, deployed]);

  function deploy() {
    setDeploying(true);
    setDeployRun(run => run + 1);
  }

  // No toast: the route's notification reports the outcome. A first deploy turns `deployed` on with the
  // reload, which reads the tasks; an update reads them here.
  function deployFinished() {
    setDeploying(false);

    if (stack && deployed) {
      load(() => readStackTasks(stack));
    }

    void router.reload();
  }

  function remove(name: string) {
    setConfirmingRemoval(false);
    operation.run(
      () => removeStack(name),
      { success: t("sheet.removed"), error: t("sheet.removeFailed") },
      async () => {
        onClose();
        await router.reload();
      },
    );
  }

  return (
    <Sheet open={stack !== null} onOpenChange={open => !open && onClose()}>
      {/* The full screen on a phone, for the task table. The `data-[side=right]` prefix is the sheet's
          own, which a bare `sm:max-w-*` would not override. */}
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{stack}</SheetTitle>
          <SheetDescription>
            {deployed ? t("sheet.deployedDescription") : t("sheet.undeployedDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {deployed && (
              <PendingButton
                type="button"
                size="sm"
                variant="outline"
                pending={tasks.isLoading}
                pendingLabel={t("refresh")}
                icon={<RefreshCwIcon data-icon="inline-start" />}
                onClick={() => stack && load(() => readStackTasks(stack))}
              >
                {t("refresh")}
              </PendingButton>
            )}
            {manageable && (
              <PendingButton
                type="button"
                size="sm"
                pending={deploying}
                disabled={operation.isPending}
                pendingLabel={deployLabel}
                icon={<DeployIcon data-icon="inline-start" />}
                onClick={deploy}
                title="docker stack deploy"
              >
                {deployLabel}
              </PendingButton>
            )}
            {manageable && stack && <EditAppLink app={stack} size="sm" />}
            {manageable && deployed && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={operation.isPending || deploying}
                onClick={() => setConfirmingRemoval(true)}
                title="docker stack rm"
              >
                <Trash2Icon data-icon="inline-start" />
                {t("sheet.delete")}
              </Button>
            )}
          </div>

          {!deployed && deployRun === 0 && <p className="text-sm text-muted-foreground">{t("sheet.notDeployed")}</p>}

          {stack && deployRun > 0 && <StackDeployOutput key={deployRun} stack={stack} onFinished={deployFinished} />}

          {tasks.error && (
            <Alert variant="destructive">
              <AlertDescription>{tasks.error}</AlertDescription>
            </Alert>
          )}

          {stack && tasks.value && <ServiceLogs stack={stack} tasks={tasks.value} />}

          {tasks.value && <TaskTable tasks={tasks.value} />}
        </div>
      </SheetContent>

      <ConfirmDialog
        open={confirmingRemoval}
        title={t("sheet.confirmTitle", { stack: stack ?? "" })}
        description={t("sheet.confirmDescription")}
        confirmLabel={t("sheet.delete")}
        destructive
        onConfirm={() => stack && remove(stack)}
        onCancel={() => setConfirmingRemoval(false)}
      />
    </Sheet>
  );
}

/** One logs button per service of the stack, each following every task of it, on every node. */
function ServiceLogs({ stack, tasks }: { stack: string; tasks: SwarmStackTask[] }) {
  const { t } = useTranslation(ClusterMessages);
  const services = [...new Set(tasks.map(task => task.service))].sort();

  if (services.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("sheet.logs")}</span>
      {services.map(service => (
        <LogsSheet
          key={service}
          endpoint={`/api/docker/swarm/stacks/${encodeURIComponent(stack)}/services/${encodeURIComponent(service)}/logs`}
          name={service}
          context={t("sheet.logsContext", { stack })}
          label={service}
        />
      ))}
    </div>
  );
}

/** One row per task, the failed ones with Docker's reason. */
function TaskTable({ tasks }: { tasks: SwarmStackTask[] }) {
  const { t, locale } = useTranslation(ClusterMessages);

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("sheet.noTasks")}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("sheet.task")}</TableHead>
          <TableHead>{t("sheet.node")}</TableHead>
          <TableHead>{t("sheet.state")}</TableHead>
          <TableHead>{t("sheet.error")}</TableHead>
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
                  · {RelativeTime.format(Date.parse(task.since), Date.now(), Locale.intlTag(locale))}
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
