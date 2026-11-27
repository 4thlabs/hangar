import { Link } from "@tanstack/react-router";
import type { ProjectSummary } from "#libs/api";
import { appsLabels } from "#modules/apps/helpers/apps-labels.ts";
import type { AppSortColumn, AppsSort } from "#modules/apps/helpers/apps-search.ts";
import { categoryBadgeClasses } from "#modules/apps/helpers/category-badge.ts";
import { statusBadgeVariant } from "#modules/apps/helpers/project-status.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import { toggledSet } from "#modules/common/helpers/toggled-set.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";
import { m } from "#paraglide/messages.js";

type AppsTableProps = {
  projects: readonly ProjectSummary[];
  sort: AppsSort;
  onSort: (column: AppSortColumn) => void;
  /** The names of the apps selected, which the page's compose commands run on. */
  selection: ReadonlySet<string>;
  onSelectionChange: (selection: ReadonlySet<string>) => void;
};

/**
 * The installed apps, a row each, which leads to its page, and a checkbox that selects it; an app the last image check
 * found an update for has its badge.
 */
export function AppsTable({ projects, sort, onSort, selection, onSelectionChange }: AppsTableProps) {
  const isAllSelected = projects.length > 0 && projects.every(project => selection.has(project.name));
  const toggle = (name: string, checked: boolean) => onSelectionChange(toggledSet(selection, name, checked));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              aria-label={m.apps_table_select_all()}
              checked={isAllSelected}
              onChange={event =>
                onSelectionChange(event.target.checked ? new Set(projects.map(project => project.name)) : new Set())
              }
            />
          </TableHead>
          <SortableHead column="name" label={m.apps_table_app()} sort={sort} onSort={onSort} />
          <SortableHead column="category" label={m.apps_table_category()} sort={sort} onSort={onSort} />
          <SortableHead column="status" label={m.apps_table_status()} sort={sort} onSort={onSort} />
          <SortableHead column="services" label={m.apps_table_services()} sort={sort} onSort={onSort} />
          <SortableHead column="containers" label={m.apps_table_containers()} sort={sort} onSort={onSort} />
          <SortableHead column="unhealthy" label={m.apps_table_unhealthy()} sort={sort} onSort={onSort} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map(project => (
          <TableRow key={project.name}>
            <TableCell>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={m.apps_table_select({ name: project.name })}
                checked={selection.has(project.name)}
                onChange={event => toggle(project.name, event.target.checked)}
              />
            </TableCell>
            <TableCell className="font-medium">
              <div className="flex flex-wrap items-center gap-2">
                {project.icon && <img src={project.icon} alt="" className="size-5 object-contain" />}
                <Link to="/apps/$project" params={{ project: project.name }} className="hover:underline">
                  {project.name}
                </Link>
                {project.updateAvailable && <Badge variant="outline">{m.apps_table_update()}</Badge>}
              </div>
            </TableCell>
            <TableCell>
              {project.category ? (
                <Badge variant="secondary" className={categoryBadgeClasses[project.category.color]}>
                  {project.category.name}
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={statusBadgeVariant(project.status)}>{appsLabels.status[project.status]()}</Badge>
            </TableCell>
            <TableCell className="tabular-nums">{project.serviceCount}</TableCell>
            <TableCell className="tabular-nums">
              {project.runningCount}/{project.containerIds.length}
            </TableCell>
            <TableCell className="tabular-nums">{project.unhealthyCount > 0 ? project.unhealthyCount : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
