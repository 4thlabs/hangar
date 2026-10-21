import { SwarmDaemonError, SwarmRefusedError, type SwarmRefusal } from "#libs/docker";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";

/** A failed swarm action as its toast words it. */
export class SwarmFailure {
  /** Why Hangar turned a node action down. */
  private static readonly RefusalMessage: Record<SwarmRefusal, string> = {
    "already-done": "Ce nœud est déjà dans cet état.",
    "last-manager": "C'est le dernier manager du cluster : le rétrograder le laisserait sans manager.",
    "not-raft-member": "Ce nœud n'a jamais rejoint les managers : Docker ne peut pas le rétrograder, retirez-le.",
    "manager-not-removable": "Un manager ne peut pas être retiré : rétrogradez-le d'abord.",
    "node-not-down": "Un nœud prêt ne peut pas être retiré : drainez-le, puis faites-lui quitter le swarm.",
    "unknown-node": "Ce nœud ne fait plus partie du cluster.",
  };

  /**
   * Hangar's refusal, the daemon's own words (an address to choose, a quorum to keep), Docker's
   * complaint from the CLI, or a pointer to the log.
   * @param log What failed, for the log line
   * @param context Fields for the log line; never a join token, which is a credential
   */
  static from(error: unknown, log: string, context: Record<string, unknown> = {}): ActionResult {
    if (error instanceof SwarmRefusedError) {
      return ActionResult.failure(SwarmFailure.RefusalMessage[error.refusal]);
    }

    if (error instanceof SwarmDaemonError) {
      return ActionResult.failure(`Docker a refusé : ${error.message}`);
    }

    return ActionFailure.from(error, log, "L'opération a échoué.", context);
  }
}
