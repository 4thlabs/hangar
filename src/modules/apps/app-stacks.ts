import { swarm } from "#libs/docker/server";
import { logger } from "#libs/logs";

/** What the swarm runs of the store's apps, for the store's own actions. */
export class AppStacks {
  /**
   * Whether a stack named after the app runs in the swarm, as far as this node can tell: only a
   * manager lists the stacks, so on any other node the answer is `false`.
   */
  static async exists(appId: string): Promise<boolean> {
    try {
      const cluster = await swarm.cluster();

      return cluster.state === "manager" && cluster.stacks.some(stack => stack.name === appId);
    } catch (error) {
      // An unreadable swarm must not block an uninstall: the stack, if any, is left to remove by hand.
      logger.warn("Could not tell whether an app has a stack", { error, appId });

      return false;
    }
  }
}
