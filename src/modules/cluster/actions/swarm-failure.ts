import { SwarmDaemonError, SwarmRefusedError } from "#libs/docker";
import { ServerTranslation } from "#libs/i18n/server";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";

/** A failed swarm action as its toast words it. */
export class SwarmFailure {
  /**
   * Hangar's refusal, the daemon's own words (an address to choose, a quorum to keep), Docker's
   * complaint from the CLI, or a pointer to the log.
   * @param log What failed, for the log line
   * @param context Fields for the log line; never a join token, which is a credential
   */
  static from(error: unknown, log: string, context: Record<string, unknown> = {}): ActionResult {
    const { t } = ServerTranslation.get(ClusterMessages);

    if (error instanceof SwarmRefusedError) {
      return ActionResult.failure(t(`actions.refusal.${error.refusal}`));
    }

    if (error instanceof SwarmDaemonError) {
      return ActionResult.failure(t("actions.dockerRefused", { message: error.message }));
    }

    return ActionFailure.from(error, log, t("actions.failed"), context);
  }
}
