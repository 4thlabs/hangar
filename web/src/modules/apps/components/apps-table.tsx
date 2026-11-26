import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ProjectSummary } from "#libs/api";
import type { AppSortColumn, AppsSort } from "#modules/apps/apps-search.ts";
import { CategoryBadge } from "#modules/apps/category-badge.ts";
import { ComposeDialogs, ComposeOperationButtons } from "#modules/apps/components/compose-operations.tsx";
import { RunningBatches } from "#modules/apps/components/running-batches.tsx";
import { ComposeActions } from "#modules/apps/compose-actions.ts";
import { useComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { ProjectStatusView } from "#modules/apps/project-status.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import { ToggledSet } from "#modules/common/toggled-set.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type AppsTableProps = {
  projects: readonly ProjectSummary[];
  sort: AppsSort;
  onSort: (column: AppSortColumn) => void;
};

/**
 * The installed apps, a row each, which leads to its page, and the compose commands over those selected. The update
 * badge comes with the image check of #176.
 */
export function AppsTable({ projects, sort, onSort }: AppsTableProps) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  // The list is read again while a selection is held: the names that went are dropped.
  const selected = projects.map(project => project.name).filter(name => selection.has(name));
  const compose = useComposeCommand(selected);
  const isAllSelected = selected.length === projects.length && projects.length > 0;
  const selectionLabel = selected.length === 0 ? "No selection" : `${ComposeActions.count(selected.length)} selected`;
  const toggle = (name: string, checked: boolean) => setSelection(current => ToggledSet.create(current, name, checked));

  return (
    <div className="flex flex-col gap-3">
      <RunningBatches compose={compose} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {selectionLabel}
        </span>
        <ComposeOperationButtons compose={compose} size="sm" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label="Select all"
                checked={isAllSelected}
                onChange={event =>
                  setSelection(event.target.checked ? new Set(projects.map(project => project.name)) : new Set())
                }
              />
            </TableHead>
            <SortableHead column="name" label="App" sort={sort} onSort={onSort} />
            <SortableHead column="category" label="Category" sort={sort} onSort={onSort} />
            <SortableHead column="status" label="Status" sort={sort} onSort={onSort} />
            <SortableHead column="services" label="Services" sort={sort} onSort={onSort} />
            <SortableHead column="containers" label="Containers" sort={sort} onSort={onSort} />
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
                  aria-label={`Select ${project.name}`}
                  checked={selection.has(project.name)}
                  onChange={event => toggle(project.name, event.target.checked)}
                />
              </TableCell>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {project.icon && <img src={project.icon} alt="" className="size-5 object-contain" />}
                  <Link to="/apps/$project" params={{ project: project.name }} className="hover:underline">
                    {project.name}
                  </Link>
                </div>
              </TableCell>
              <TableCell>
                {project.category ? (
                  <Badge variant="secondary" className={CategoryBadge.Classes[project.category.color]}>
                    {project.category.name}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={ProjectStatusView.variant(project.status)}>
                  {ProjectStatusView.Labels[project.status]}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{project.serviceCount}</TableCell>
              <TableCell className="tabular-nums">
                {project.runningCount}/{project.containerIds.length}
              </TableCell>
              <TableCell className="tabular-nums">
                {project.unhealthyCount > 0 ? project.unhealthyCount : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ComposeDialogs compose={compose} subject={ComposeActions.subject(selected)} count={selected.length} />
    </div>
  );
}
