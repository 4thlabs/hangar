import { AppInstallation } from "#modules/apps/installation.ts";
import type { ClusterStack } from "#modules/cluster/cluster-stacks.ts";
import {
  ClusterSearch,
  type ClusterSearchState,
  type StackHealth,
  type StackOrigin,
  type StackSortColumn,
} from "#modules/cluster/search.ts";
import { countBy } from "#modules/common/count-by.ts";
import { searchByName } from "#modules/common/search.ts";
import { TableSort } from "#modules/common/table-sort.ts";

/** How many stacks each filter option would keep, for the menus. */
export type StackFilterCounts = {
  health: Partial<Record<string, number>>;
  node: Partial<Record<string, number>>;
  origin: Partial<Record<string, number>>;
};

/** The /cluster stack table's filters and sort, applied to what the server read. */
export class StackFilter {
  /** What each sortable column compares on. Health sorts by severity, the best first. */
  private static readonly SortValue: Record<StackSortColumn, (stack: ClusterStack) => number | string> = {
    name: stack => stack.name,
    health: stack => ClusterSearch.Healths.indexOf(stack.health),
    replicas: stack => stack.desired,
    nodes: stack => stack.placement.length,
  };

  /**
   * Narrows the stacks to the selected healths, nodes and origins, then to the query, then sorts them.
   * @param manageable The stacks Hangar can redeploy, which make the `hangar` origin
   */
  static apply(stacks: readonly ClusterStack[], search: ClusterSearchState, manageable: readonly string[]) {
    const kept = stacks.filter(
      stack =>
        StackFilter.matchesHealth(search.health, stack) &&
        StackFilter.runsOnAny(stack, search.node) &&
        StackFilter.matches(search.origin, StackFilter.origin(stack, manageable)),
    );

    const found = searchByName(search.q, kept);

    // An explicit column wins over relevance: the user asked for that order.
    return search.sort ? TableSort.apply(found, search.sort, StackFilter.SortValue[search.sort.column]) : found;
  }

  /** How many stacks fall under each option of each filter, over every stack. */
  static counts(stacks: readonly ClusterStack[], manageable: readonly string[]): StackFilterCounts {
    return {
      health: countBy(stacks.filter(AppInstallation.isInstalled), stack => stack.health),
      node: countBy(
        stacks.flatMap(stack => stack.placement),
        place => place.hostname,
      ),
      origin: countBy(stacks, stack => StackFilter.origin(stack, manageable)),
    };
  }

  /** A store app comes from Hangar whether it is installed or not. */
  static origin(stack: ClusterStack, manageable: readonly string[]): StackOrigin {
    return !AppInstallation.isInstalled(stack) || manageable.includes(stack.name) ? "hangar" : "other";
  }

  /** A store app not installed has no health in the swarm, so a health filter leaves it out, as `/apps` does. */
  private static matchesHealth(selected: readonly StackHealth[], stack: ClusterStack) {
    return selected.length === 0 || (AppInstallation.isInstalled(stack) && selected.includes(stack.health));
  }

  /** An empty selection is no filter. */
  private static matches<T>(selected: readonly T[], value: T) {
    return selected.length === 0 || selected.includes(value);
  }

  private static runsOnAny(stack: ClusterStack, hostnames: readonly string[]) {
    return hostnames.length === 0 || stack.placement.some(place => hostnames.includes(place.hostname));
  }
}
