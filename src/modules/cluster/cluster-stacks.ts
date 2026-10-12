import type { SwarmStack } from "#libs/docker";
import type { StackHealth } from "#modules/cluster/search.ts";

/** A row of the /cluster stack table: a stack of the swarm, or an installed swarm-ready app not deployed yet. */
export type ClusterStack = Omit<SwarmStack, "health"> & { health: StackHealth };

/** The rows of the /cluster stack table, as /apps lists every installed app, started or not. */
export class ClusterStacks {
  /**
   * The swarm's stacks, plus one undeployed row per app Hangar can deploy that no stack runs yet, by name.
   * @param deployable The installed apps with a compose.swarm.yml
   */
  static list(stacks: readonly SwarmStack[], deployable: readonly string[]): ClusterStack[] {
    const deployed = new Set(stacks.map(stack => stack.name));

    const undeployed = deployable
      .filter(name => !deployed.has(name))
      .map((name): ClusterStack => ({ name, health: "undeployed", running: 0, desired: 0, placement: [] }));

    return [...stacks, ...undeployed].sort((left, right) => left.name.localeCompare(right.name));
  }

  static isDeployed(stack: ClusterStack) {
    return stack.health !== "undeployed";
  }
}
