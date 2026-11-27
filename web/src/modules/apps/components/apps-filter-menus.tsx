import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ProjectSummary } from "#libs/api";
import { appsLabels } from "#modules/apps/helpers/apps-labels.ts";
import {
  appStatuses,
  appUpdates,
  joinSearchValues,
  parseAppCategories,
  parseAppStatuses,
  parseAppUpdates,
} from "#modules/apps/helpers/apps-search.ts";
import { countBy, updateSideOf } from "#modules/apps/helpers/project-filter.ts";
import { CheckboxFilterMenu } from "#modules/common/components/checkbox-filter-menu.tsx";
import { m } from "#paraglide/messages.js";

type AppsFilterMenusProps = {
  /** Every installed app, which the counts beside each checkbox are taken from. */
  projects: readonly ProjectSummary[];
};

/**
 * The filters of `/apps`, ticked in its URL: by category, listed from the installed apps rather than `hangar.yml`, so
 * that none keeps nothing, by status, and by whether the last image check found an update.
 */
export function AppsFilterMenus({ projects }: AppsFilterMenusProps) {
  const search = useSearch({ from: "/_app/apps/" });
  const navigate = useNavigate({ from: "/apps/" });
  const statusCounts = countBy(projects, project => project.status);
  const categoryCounts = countBy(projects, project => project.category?.name);
  const updateCounts = countBy(projects, updateSideOf);
  const categories = [...categoryCounts.keys()].sort((left, right) => left.localeCompare(right));

  const write = (key: "status" | "category" | "update", selected: readonly string[]) =>
    void navigate({ search: previous => ({ ...previous, [key]: joinSearchValues(selected) }), replace: true });

  return (
    <>
      {categories.length > 0 && (
        <CheckboxFilterMenu
          label={m.apps_filters_category()}
          options={categories.map(category => ({
            value: category,
            label: category,
            count: categoryCounts.get(category) ?? 0,
          }))}
          selected={parseAppCategories(search.category)}
          onChange={selected => write("category", selected)}
        />
      )}
      <CheckboxFilterMenu
        label={m.apps_filters_status()}
        options={appStatuses.map(status => ({
          value: status,
          label: appsLabels.status[status](),
          count: statusCounts.get(status) ?? 0,
        }))}
        selected={parseAppStatuses(search.status)}
        onChange={selected => write("status", selected)}
      />
      <CheckboxFilterMenu
        label={m.apps_filters_update()}
        options={appUpdates.map(update => ({
          value: update,
          label: appsLabels.update[update](),
          count: updateCounts.get(update) ?? 0,
        }))}
        selected={parseAppUpdates(search.update)}
        onChange={selected => write("update", selected)}
      />
    </>
  );
}
