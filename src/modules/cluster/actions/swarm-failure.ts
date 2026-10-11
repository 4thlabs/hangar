import { SwarmDaemonError, SwarmRefusedError, type SwarmRefusal } from "#libs/docker";
import { actionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";

/** Why Hangar turned a node action down, as the toast words it. */
const RefusalMessage: Record<SwarmRefusal, string> = {
  "already-done": "Ce nœud est déjà dans cet état.",
  "last-manager": "C'est le dernier manager du cluster : le rétrograder le laisserait sans manager.",
  "manager-not-removable": "Un manager ne peut pas être retiré : rétrogradez-le d'abord.",
  "node-not-down": "Seul un nœud injoignable peut être retiré : arrêtez-le, ou faites-lui quitter le swarm.",
  "unknown-node": "Ce nœud ne fait plus partie du cluster.",
};

/**
 * A failed swarm action as its toast words it: Hangar's refusal, the daemon's own words (an address to
 * choose, a quorum to keep), Docker's complaint from the CLI, or a pointer to the log.
 * @param log What failed, for the log line
 * @param context Fields for the log line; never a join token, which is a credential
 */
export function swarmFailure(error: unknown, log: string, context: Record<string, unknown> = {}): ActionResult {
  if (error instanceof SwarmRefusedError) {
    return ActionResult.failure(RefusalMessage[error.refusal]);
  }

  if (error instanceof SwarmDaemonError) {
    return ActionResult.failure(`Docker a refusé : ${error.message}`);
  }

  return actionFailure(error, log, "L'opération a échoué.", context);
}
