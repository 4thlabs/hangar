import { Link } from "@tanstack/react-router";
import type { ProjectSummary } from "#libs/api";
import type { AppSortColumn, AppsSort } from "#modules/apps/apps-search.ts";
import { CategoryBadge } from "#modules/apps/category-badge.ts";
import { ProjectStatusView } from "#modules/apps/project-status.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type AppsTableProps = {
  projects: readonly ProjectSummary[];
  sort: AppsSort;
  onSort: (column: AppSortColumn) => void;
};

/**
 * The installed apps, a row each, which leads to its page. The batch of compose commands over a selection comes with
 * #173, and the update badge with the image check of #176.
 */
export function AppsTable({ projects, sort, onSort }: AppsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
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
            <TableCell className="tabular-nums">{project.unhealthyCount > 0 ? project.unhealthyCount : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

