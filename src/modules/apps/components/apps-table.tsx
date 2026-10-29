"use client";

import { useState } from "react";
import { Link } from "waku";
import type { ComposeProjectSummary } from "#libs/docker";
import { categoryBadgeClass } from "#modules/apps/category.ts";
import { AppRowActions } from "#modules/apps/components/app-row-actions.tsx";
import { ComposeOperationButtons, ComposeRunDialogs } from "#modules/apps/components/compose-operations.tsx";
import { plural, s } from "#modules/apps/format.ts";
import { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";
import { AppInstallation } from "#modules/apps/installation.ts";
import type { AppSortColumn, AppsSort } from "#modules/apps/search-codec.ts";
import { statusLabel, statusVariant } from "#modules/apps/status.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import { navigationPrefetch } from "#modules/common/navigations.ts";
import { ToggledSet } from "#modules/common/toggled-set.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type AppsTableProps = {
  projects: ComposeProjectSummary[];
  sort?: AppsSort;
  onSort?: (column: AppSortColumn) => void;
};

export function AppsTable({ projects, sort = null, onSort }: AppsTableProps) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  // Compose runs on installed apps alone, so only they can be selected.
  const selectable = projects.filter(AppInstallation.isInstalled).map(project => project.name);
  // The list re-renders while a selection is held, so drop names that disappeared meanwhile.
  const selected = selectable.filter(name => selection.has(name));
  const compose = useComposeRun(selected);

  function toggle(name: string, checked: boolean) {
    setSelection(current => ToggledSet.create(current, name, checked));
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
          flags={compose.flags}
          onToggleFlag={compose.toggleFlag}
          onRequest={compose.request}
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
                checked={selected.length === selectable.length && selectable.length > 0}
                onChange={event => setSelection(event.target.checked ? new Set(selectable) : new Set())}
              />
            </TableHead>
            <SortableHead column="name" label="Application" sort={sort} onSort={onSort} />
            <SortableHead column="category" label="Catégorie" sort={sort} onSort={onSort} />
            <SortableHead column="status" label="Statut" sort={sort} onSort={onSort} />
            <SortableHead column="services" label="Services" sort={sort} onSort={onSort} />
            <SortableHead column="containers" label="Conteneurs" sort={sort} onSort={onSort} />
            <SortableHead column="unhealthy" label="Unhealthy" sort={sort} onSort={onSort} />
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map(project => (
            <AppRow
              key={project.name}
              project={project}
              selected={selection.has(project.name)}
              onSelect={checked => toggle(project.name, checked)}
            />
          ))}
        </TableBody>
      </Table>

      <ComposeRunDialogs compose={compose} subject={plural(selected.length, "application")} count={selected.length} />
    </div>
  );
}

type AppRowProps = {
  project: ComposeProjectSummary;
  selected: boolean;
  onSelect: (checked: boolean) => void;
};

/** One app: its Docker state when installed; otherwise only what the store knows, and the way to install it. */
function AppRow({ project, selected, onSelect }: AppRowProps) {
  const installed = AppInstallation.isInstalled(project);

  return (
    <TableRow className={installed ? undefined : "text-muted-foreground"}>
      <TableCell>
        {installed && (
          <input
            type="checkbox"
            className="size-4 accent-primary"
            aria-label={`Sélectionner ${project.name}`}
            checked={selected}
            onChange={event => onSelect(event.target.checked)}
          />
        )}
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex flex-wrap items-center gap-2">
          {project.icon && <img src={project.icon} alt="" className="size-5 object-contain" />}
          {installed ? (
            <Link
              to={{ to: "/apps/[project]", params: { project: project.name } }}
              unstable_prefetchOnEnter={navigationPrefetch}
              className="hover:underline"
            >
              {project.name}
            </Link>
          ) : (
            project.name
          )}
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
        {installed ? (
          <Badge variant={statusVariant(project.status)}>{statusLabel[project.status]}</Badge>
        ) : (
          <Badge variant="outline">Non installée</Badge>
        )}
      </TableCell>
      <TableCell className="tabular-nums">{installed ? project.serviceCount : "—"}</TableCell>
      <TableCell className="tabular-nums">
        {installed ? `${project.runningCount}/${project.containerIds.length}` : "—"}
      </TableCell>
      <TableCell className="tabular-nums">{project.unhealthyCount > 0 ? project.unhealthyCount : "—"}</TableCell>
      <TableCell>
        <AppRowActions app={project.name} installed={installed} />
      </TableCell>
    </TableRow>
  );
}
