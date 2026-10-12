import type { Unstable_SearchCodec } from "waku/router";
import type { SwarmStackHealth } from "#libs/docker";
import { TableSort, type SortState } from "#modules/common/table-sort.ts";

/** Sortable columns of the stack table. */
export type StackSortColumn = "name" | "health" | "replicas" | "nodes";

/** A stack's health in the swarm, or `undeployed` for an installed swarm-ready app no stack runs yet. */
export type StackHealth = SwarmStackHealth | "undeployed";

/** Whether Hangar can redeploy a stack (a store app with a compose.swarm.yml), or something else deployed it. */
export type StackOrigin = "hangar" | "other";

/** What the /cluster stack table shows, as its search params say it. */
export type ClusterSearchState = {
  q: string;
  health: StackHealth[];
  /** Hostnames: a stack shows when one of its tasks runs on one of them. */
  node: string[];
  origin: StackOrigin[];
  /** `null` means the default order: search relevance when there is a query, alphabetical otherwise. */
  sort: SortState<StackSortColumn>;
};

/** The search params of /cluster, comma-separated multi-selects where empty means no filter. */
export class ClusterSearch {
  /** Every health, from the best, in the order the filter lists them and the column sorts them. */
  static readonly Healths: readonly StackHealth[] = ["running", "partial", "stopped", "undeployed"];

  static readonly Origins: readonly StackOrigin[] = ["hangar", "other"];

  static readonly SortColumns: readonly StackSortColumn[] = ["name", "health", "replicas", "nodes"];

  /** Unknown healths, origins and columns are dropped; hostnames are kept as written, matching nothing if gone. */
  static readonly Codec: Unstable_SearchCodec<ClusterSearchState> = {
    id: "cluster",
    parse: query => {
      const params = new URLSearchParams(query);
      const list = (name: string) => (params.get(name) ?? "").split(",").filter(Boolean);

      return {
        q: params.get("q") ?? "",
        health: ClusterSearch.Healths.filter(health => list("health").includes(health)),
        node: list("node"),
        origin: ClusterSearch.Origins.filter(origin => list("origin").includes(origin)),
        sort: TableSort.parse(params.get("sort") ?? "", ClusterSearch.SortColumns),
      };
    },
    serialize: ({ q, health, node, origin, sort }) => {
      const params = new URLSearchParams();
      const lists = { health, node, origin };

      if (q) {
        params.set("q", q);
      }

      for (const [name, values] of Object.entries(lists)) {
        if (values.length > 0) {
          params.set(name, values.join(","));
        }
      }

      if (sort) {
        params.set("sort", TableSort.serialize(sort));
      }

      return params.toString();
    },
  };
}
