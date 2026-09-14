"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { Link } from "waku";
import { ActionResult } from "#app/actions/action-result.ts";
import { actionLabel, type AppOperation } from "#app/actions/apps/app-operation.ts";
import {
  ComposeConfirmDialog,
  ComposeOperationButtons,
  type DestructiveOperation,
} from "#app/components/apps/compose-operations.tsx";
import { statusLabel, statusVariant } from "#app/components/apps/status.ts";
import { Badge } from "#app/components/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#app/components/ui/table.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";
import type { AppSortColumn, AppsSort } from "#app/search-codecs.ts";
import type { ComposeProjectSummary } from "#libs/docker";

type AppsTableProps = {
  projects: ComposeProjectSummary[];
  manageApp?: ((project: string, operation: AppOperation) => Promise<ActionResult>) | undefined;
  refresh: () => Promise<void>;
  sort?: AppsSort;
  onSort?: (column: AppSortColumn) => void;
};

type SortableHeadProps = {
  column: AppSortColumn;
  label: string;
  sort: AppsSort;
  onSort: ((column: AppSortColumn) => void) | undefined;
  className?: string;
};

/** A column header that toggles the table's sort, announcing its state to screen readers. */
function SortableHead({ column, label, sort, onSort, className }: SortableHeadProps) {
  const active = sort?.column === column;
  const Icon = active ? (sort.descending ? ArrowDownIcon : ArrowUpIcon) : ChevronsUpDownIcon;

  return (
    <TableHead className={className} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        className="-mx-1 flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:text-foreground/80"
        onClick={() => onSort?.(column)}
      >
        {label}
        <Icon aria-hidden="true" className={active ? "size-3.5" : "size-3.5 text-muted-foreground"} />
      </button>
    </TableHead>
  );
}

const plural = (count: number, singular: string) => `${count} ${singular}${count > 1 ? "s" : ""}`;

export function AppsTable({ projects, manageApp, refresh, sort = null, onSort }: AppsTableProps) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [confirmation, setConfirmation] = useState<DestructiveOperation | null>(null);
  const [pendingOperation, setPendingOperation] = useState<AppOperation | null>(null);
  const { run: runAction, isPending } = useServerAction();

  // The snapshot is refreshed while a selection is held, so drop names that disappeared meanwhile.
  const selected = projects.map(project => project.name).filter(name => selection.has(name));
  const disabled = selected.length === 0 || !manageApp || isPending;

  function toggle(name: string, checked: boolean) {
    setSelection(current => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function run(operation: AppOperation) {
    if (!manageApp || selected.length === 0) return;

    setConfirmation(null);
    setPendingOperation(operation);
    runAction(
      // One toast for the batch: the outcome the user cares about is "did all of them work".
      async () => {
        const results: ActionResult[] = [];
        // Sequential: compose commands against the same daemon are cheap but not worth racing.
        for (const project of selected) results.push(await manageApp(project, operation));

        const failures = results.filter(result => !result.success);

        return failures.length === 0
          ? ActionResult.success(`${plural(results.length, "application")} traitée${results.length > 1 ? "s" : ""}.`)
          : ActionResult.failure(
              `${plural(failures.length, "échec")} sur ${results.length} : ${failures.map(failure => failure.message).join(" ")}`,
            );
      },
      {
        success: `${actionLabel[operation]} terminé`,
        error: `${actionLabel[operation]} échoué`,
        transport: "La commande n’a pas pu être transmise au serveur.",
      },
      async () => {
        setPendingOperation(null);
        await refresh();
      },
    );
  }

  const confirmationTitle =
    confirmation === "down"
      ? `Arrêter ${plural(selected.length, "application")} ?`
      : `Recréer ${plural(selected.length, "application")} ?`;
  const confirmationDescription =
    confirmation === "down"
      ? "Docker Compose supprimera les conteneurs et réseaux de ces applications. Elles resteront listées, à l’arrêt."
      : "Tous les conteneurs de ces applications seront recréés, même si leur configuration n’a pas changé.";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length > 0
            ? `${plural(selected.length, "application")} sélectionnée${selected.length > 1 ? "s" : ""}`
            : "Aucune sélection"}
        </span>
        <ComposeOperationButtons
          running={pendingOperation}
          disabled={disabled}
          size="sm"
          onRun={run}
          onConfirm={setConfirmation}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label="Tout sélectionner"
                checked={selected.length === projects.length && projects.length > 0}
                onChange={event => setSelection(event.target.checked ? new Set(projects.map(p => p.name)) : new Set())}
              />
            </TableHead>
            <SortableHead column="name" label="Application" sort={sort} onSort={onSort} />
            <SortableHead column="status" label="Statut" sort={sort} onSort={onSort} />
            <SortableHead column="services" label="Services" sort={sort} onSort={onSort} />
            <SortableHead column="containers" label="Conteneurs" sort={sort} onSort={onSort} />
            <SortableHead column="unhealthy" label="Unhealthy" sort={sort} onSort={onSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map(project => (
            <TableRow key={project.name}>
              <TableCell>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={`Sélectionner ${project.name}`}
                  checked={selection.has(project.name)}
                  onChange={event => toggle(project.name, event.target.checked)}
                />
              </TableCell>
              <TableCell className="font-medium">
                <Link to={{ to: "/apps/[project]", params: { project: project.name } }} className="hover:underline">
                  {project.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(project.status)}>{statusLabel[project.status]}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">{project.serviceCount}</TableCell>
              <TableCell className="tabular-nums">
                {project.runningCount}/{project.containerCount}
              </TableCell>
              <TableCell className="tabular-nums">
                {project.unhealthyCount > 0 ? project.unhealthyCount : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ComposeConfirmDialog
        operation={confirmation}
        title={confirmationTitle}
        description={confirmationDescription}
        onConfirm={run}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  );
}
