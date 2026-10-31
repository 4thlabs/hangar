import { HangarError } from "#libs/hangar";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { ActionResult } from "#modules/common/actions/action-result.ts";
import { CommonMessages } from "#modules/common/messages.ts";

/** A failed server action as its toast words it. Server-only, unlike `ActionResult`, which clients import. */
export class ActionFailure {
  /**
   * An operator error (a `HangarError`, Docker's complaint among them) as is, since it says what to
   * fix; anything else logged, with a pointer to the log.
   * @param log What failed, for the log line
   * @param fallback What failed, for the toast, in the reader's language
   * @param context Fields for the log line
   */
  static from(error: unknown, log: string, fallback: string, context: Record<string, unknown> = {}): ActionResult {
    if (error instanceof HangarError) {
      return ActionResult.failure(error.message);
    }

    logger.error(log, { error, ...context });

    return ActionResult.failure(ActionFailure.withLogHint(fallback));
  }

  /**
   * `message` followed by where the details are: the server's log, not the UI.
   */
  static withLogHint(message: string) {
    const { t } = ServerTranslation.get(CommonMessages);

    return `${message} ${t("actions.serverLogHint")}`;
  }
}
