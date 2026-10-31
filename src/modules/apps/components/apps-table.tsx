"use client";

import { useState } from "react";
import { Link } from "waku";
import type { ComposeProjectSummary } from "#libs/docker";
import { categoryBadgeClass } from "#modules/apps/category.ts";
import { ComposeOperationButtons, ComposeRunDialogs } from "#modules/apps/components/compose-operations.tsx";
import { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import type { AppSortColumn, AppsSort } from "#modules/apps/search-codec.ts";
import { statusVariant } from "#modules/apps/status.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
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
  const { t } = useTranslation(AppsMessages);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  // The list re-renders while a selection is held, so drop names that disappeared meanwhile.
  const selected = projects.map(project => project.name).filter(name => selection.has(name));
  const compose = useComposeRun(selected);

  function toggle(name: string, checked: boolean) {
    setSelection(current => ToggledSet.create(current, name, checked));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length > 0 ? t("table.selected", { count: selected.length }) : t("table.noSelection")}
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
                aria-label={t("table.selectAll")}
                checked={selected.length === projects.length && projects.length > 0}
                onChange={event => setSelection(event.target.checked ? new Set(projects.map(p => p.name)) : new Set())}
              />
            </TableHead>
            <SortableHead column="name" label={t("table.app")} sort={sort} onSort={onSort} />
            <SortableHead column="category" label={t("table.category")} sort={sort} onSort={onSort} />
            <SortableHead column="status" label={t("table.status")} sort={sort} onSort={onSort} />
            <SortableHead column="services" label={t("table.services")} sort={sort} onSort={onSort} />
            <SortableHead column="containers" label={t("table.containers")} sort={sort} onSort={onSort} />
            <SortableHead column="unhealthy" label={t("table.unhealthy")} sort={sort} onSort={onSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map(project => (
            <TableRow key={project.name}>
              <TableCell>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={t("table.select", { name: project.name })}
                  checked={selection.has(project.name)}
                  onChange={event => toggle(project.name, event.target.checked)}
                />
              </TableCell>
              <TableCell className="font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  {project.icon && <img src={project.icon} alt="" className="size-5 object-contain" />}
                  <Link
                    to={{ to: "/apps/[project]", params: { project: project.name } }}
                    unstable_prefetchOnEnter={navigationPrefetch}
                    className="hover:underline"
                  >
                    {project.name}
                  </Link>
                  {project.updateAvailable && <Badge variant="outline">{t("update")}</Badge>}
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
                <Badge variant={statusVariant(project.status)}>{t(`status.${project.status}`)}</Badge>
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

      <ComposeRunDialogs compose={compose} subject={t("apps", { count: selected.length })} count={selected.length} />
    </div>
  );
}
