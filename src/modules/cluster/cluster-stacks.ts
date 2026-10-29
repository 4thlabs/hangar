import type { SwarmStack } from "#libs/docker";
import type { StackHealth } from "#modules/cluster/search.ts";

/**
 * A row of the /cluster stack table: a stack of the swarm, or a swarm-ready store app not deployed yet. `installed`
 * is `false` for one that is not installed, which cannot be deployed until it is.
 */
export type ClusterStack = Omit<SwarmStack, "health"> & { health: StackHealth; installed?: boolean };

/** The rows of the /cluster stack table, as /apps lists every installed app, started or not. */
export class ClusterStacks {
  /**
   * The swarm's stacks, plus one undeployed row per swarm-ready store app that no stack runs yet, by name.
   * @param deployable The installed apps with a compose.swarm.yml
   * @param uninstalled The store apps with a compose.swarm.yml that are not installed; none to leave them out
   */
  static list(
    stacks: readonly SwarmStack[],
    deployable: readonly string[],
    uninstalled: readonly string[] = [],
  ): ClusterStack[] {
    const deployed = new Set(stacks.map(stack => stack.name));
    const undeployed = deployable.filter(name => !deployed.has(name)).map(ClusterStacks.undeployed);

    const notInstalled = ClusterStacks.notInstalled(stacks, uninstalled).map((name): ClusterStack => ({
      ...ClusterStacks.undeployed(name),
      installed: false,
    }));

    return [...stacks, ...undeployed, ...notInstalled].sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * The store apps not installed that get a row: one whose name a stack already has, deployed by hand, shows as
   * that stack instead.
   */
  static notInstalled(stacks: readonly SwarmStack[], uninstalled: readonly string[]) {
    const deployed = new Set(stacks.map(stack => stack.name));

    return uninstalled.filter(name => !deployed.has(name));
  }

  private static undeployed(name: string): ClusterStack {
    return { name, health: "undeployed", running: 0, desired: 0, placement: [] };
  }

  static isDeployed(stack: ClusterStack) {
    return stack.health !== "undeployed";
  }
}
