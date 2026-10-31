"use client";

import { PlusIcon, SaveIcon, TagIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "waku";
import type { SwarmNode } from "#libs/docker";
import { changeSwarmNodeLabels } from "#modules/cluster/actions/manage-cluster.ts";
import { NodeLabelBadge } from "#modules/cluster/components/node-label-badge.tsx";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { NodeLabelEdit, type NodeLabelRow } from "#modules/cluster/node-label-edit.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#modules/common/ui/dialog.tsx";
import { Input } from "#modules/common/ui/input.tsx";

type NodeLabelsDialogProps = {
  node: SwarmNode;
};

/**
 * The node labels, as lines to edit, add and drop. Nothing is sent until saved, and then only what
 * changed. The labels from the host's `daemon.json` are listed, but only the host changes them.
 */
export function NodeLabelsDialog({ node }: NodeLabelsDialogProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(ClusterMessages);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NodeLabelRow[]>([]);
  const nextId = useRef(0);

  const problems = rows.map(row => NodeLabelEdit.problem(row, rows));
  const changes = NodeLabelEdit.changes(node.labels, rows);
  const canSave = !NodeLabelEdit.isEmpty(changes) && problems.every(problem => problem === null);
  const engineLabels = Object.entries(node.engineLabels);

  /** Starts from the labels the page read, so a dialog closed without saving leaves nothing behind. */
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const initial = NodeLabelEdit.rows(node.labels);

      nextId.current = initial.length;
      setRows(initial);
    }

    setOpen(nextOpen);
  }

  function edit(id: number, change: Partial<NodeLabelRow>) {
    setRows(previous => previous.map(row => (row.id === id ? { ...row, ...change } : row)));
  }

  function add() {
    setRows(previous => [...previous, { id: nextId.current++, key: "", value: "" }]);
  }

  function save() {
    run(
      () => changeSwarmNodeLabels(node.id, node.hostname, changes),
      { success: t("labels.saved"), error: t("labels.saveFailed") },
      async result => {
        if (result?.success) {
          setOpen(false);
          await router.reload();
        }
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <TagIcon data-icon="inline-start" />
        {t("labels.trigger")}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("labels.title", { hostname: node.hostname })}</DialogTitle>
          <DialogDescription>
            {t("labels.description.before")}
            <code>compose.swarm.yml</code>
            {t("labels.description.after")}
          </DialogDescription>
        </DialogHeader>
        <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          constraints: [{NodeLabelEdit.constraint(rows)}]
        </code>

        <div className="flex flex-col gap-3">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("labels.none")}</p>}
          {rows.map((row, index) => (
            // On a phone the value goes under the key; from `sm` up, the line holds both.
            <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[11rem_1fr_auto]">
              <Input
                value={row.key}
                placeholder={t("labels.key")}
                aria-label={t("labels.keyLabel")}
                aria-invalid={problems[index] !== null}
                className="col-start-1 row-start-1 font-mono"
                onChange={event => edit(row.id, { key: event.target.value })}
              />
              <Input
                value={row.value}
                placeholder={t("labels.value")}
                aria-label={t("labels.valueOf", { key: row.key || t("labels.thisLabel") })}
                aria-invalid={problems[index] === "invalid"}
                className="col-start-1 row-start-2 font-mono sm:col-start-2 sm:row-start-1"
                onChange={event => edit(row.id, { value: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("labels.remove", { key: row.key || t("labels.thisLabel") })}
                className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1"
                onClick={() => setRows(previous => previous.filter(other => other.id !== row.id))}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}

          {problems.includes("invalid") && <p className="text-sm text-destructive">{t("labels.invalid")}</p>}
          {problems.includes("duplicate") && <p className="text-sm text-destructive">{t("labels.duplicate")}</p>}

          <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
            <PlusIcon data-icon="inline-start" />
            {t("labels.add")}
          </Button>

          {engineLabels.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {t("labels.engine.before")}
                <code>daemon.json</code>
                {t("labels.engine.middle")}
                <code>{`engine.labels.<${t("labels.key")}>`}</code>
                {t("labels.engine.after")}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {engineLabels.map(([key, value]) => (
                  <li key={key} className="max-w-full">
                    <NodeLabelBadge name={key} value={value} source="engine" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t("labels.cancel")}</DialogClose>
          <PendingButton
            type="button"
            pending={isPending}
            pendingLabel={t("labels.saving")}
            icon={<SaveIcon data-icon="inline-start" />}
            disabled={!canSave}
            onClick={save}
          >
            {t("labels.save")}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
