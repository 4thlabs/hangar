"use client";

import { PlusIcon, SaveIcon, TagIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "waku";
import type { SwarmNode } from "#libs/docker";
import { changeSwarmNodeLabels } from "#modules/cluster/actions/manage-cluster.ts";
import { NodeLabelBadge } from "#modules/cluster/components/node-label-badge.tsx";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { NodeLabelEdit, type NodeLabelRow } from "#modules/cluster/node-label-edit.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
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
      { success: "Labels enregistrés", error: "Labels : échec" },
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
        Labels
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Labels de {node.hostname}</DialogTitle>
          <DialogDescription>
            Une contrainte de placement les lit dans <code>compose.swarm.yml</code>, par exemple :
          </DialogDescription>
        </DialogHeader>
        <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          constraints: [{NodeLabelEdit.constraint(rows)}]
        </code>

        <div className="flex flex-col gap-3">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Aucun label sur ce nœud.</p>}
          {rows.map((row, index) => (
            // On a phone the value goes under the key; from `sm` up, the line holds both.
            <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[11rem_1fr_auto]">
              <Input
                value={row.key}
                placeholder="clé"
                aria-label="Clé"
                aria-invalid={problems[index] !== null}
                className="col-start-1 row-start-1 font-mono"
                onChange={event => edit(row.id, { key: event.target.value })}
              />
              <Input
                value={row.value}
                placeholder="valeur"
                aria-label={`Valeur de ${row.key || "ce label"}`}
                aria-invalid={problems[index] === "invalid"}
                className="col-start-1 row-start-2 font-mono sm:col-start-2 sm:row-start-1"
                onChange={event => edit(row.id, { value: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Supprimer ${row.key || "ce label"}`}
                className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1"
                onClick={() => setRows(previous => previous.filter(other => other.id !== row.id))}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}

          {problems.includes("invalid") && <p className="text-sm text-destructive">{ClusterLabels.InvalidLabel}</p>}
          {problems.includes("duplicate") && (
            <p className="text-sm text-destructive">Une clé ne peut servir qu’une fois.</p>
          )}

          <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
            <PlusIcon data-icon="inline-start" />
            Ajouter un label
          </Button>

          {engineLabels.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Définis dans le <code>daemon.json</code> de l’hôte, lus par <code>engine.labels.&lt;clé&gt;</code> :
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
          <DialogClose render={<Button type="button" variant="outline" />}>Annuler</DialogClose>
          <PendingButton
            type="button"
            pending={isPending}
            pendingLabel="Enregistrement…"
            icon={<SaveIcon data-icon="inline-start" />}
            disabled={!canSave}
            onClick={save}
          >
            Enregistrer
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
