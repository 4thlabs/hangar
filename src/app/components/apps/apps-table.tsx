"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { Link } from "waku";
import { categoryBadgeClass } from "#app/components/apps/category.ts";
import { plural, s } from "#app/components/apps/format.ts";
import { ComposeOperationButtons, ComposeRunDialogs } from "#app/components/apps/compose-operations.tsx";
import { useComposeRun } from "#app/components/apps/use-compose-run.ts";
import { statusLabel, statusVariant } from "#app/components/apps/status.ts";
import { Badge } from "#app/components/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#app/components/ui/table.tsx";
import type { AppSortColumn, AppsSort } from "#app/search-codecs.ts";
import type { ComposeProjectSummary } from "#libs/docker";

type AppsTableProps = {
  projects: ComposeProjectSummary[];
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

export function AppsTable({ projects, sort = null, onSort }: AppsTableProps) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  // The list re-renders while a selection is held, so drop names that disappeared meanwhile.
  const selected = projects.map(project => project.name).filter(name => selection.has(name));
  const compose = useComposeRun(selected);

  function toggle(name: string, checked: boolean) {
    setSelection(current => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length > 0
            ? `${plural(selected.length, "application")} sélectionnée${s(selected.length)}`
            : "Aucune sélection"}
        </span>
        <ComposeOperationButtons
          running={compose.running}
          disabled={compose.disabled}
          size="sm"
          onRun={compose.run}
          onConfirm={compose.setConfirmation}
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
            <SortableHead column="category" label="Catégorie" sort={sort} onSort={onSort} />
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
                <div className="flex flex-wrap items-center gap-2">
                  {project.icon && <img src={project.icon} alt="" className="size-5 object-contain" />}
                  <Link to={{ to: "/apps/[project]", params: { project: project.name } }} className="hover:underline">
                    {project.name}
                  </Link>
                  {project.updateAvailable && <Badge variant="outline">Mise à jour</Badge>}
                </div>
              </TableCell>
              <TableCell>
                {project.category ? (
                  <Badge variant="secondary" className={categoryBadgeClass[project.category.color]}>
                    {project.category.name}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
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

      <ComposeRunDialogs compose={compose} subject={plural(selected.length, "application")} many />
    </div>
  );
}
