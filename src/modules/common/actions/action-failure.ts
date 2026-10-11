import { HangarError } from "#libs/hangar";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

/**
 * A failed server action as its toast words it: an operator error (a `HangarError`, Docker's complaint
 * among them) as is, since it says what to fix; anything else logged, with a pointer to the log.
 * @param log What failed, for the log line
 * @param fallback What failed, for the toast
 * @param context Fields for the log line
 */
export function actionFailure(
  error: unknown,
  log: string,
  fallback: string,
  context: Record<string, unknown> = {},
): ActionResult {
  if (error instanceof HangarError) {
    return ActionResult.failure(error.message);
  }

  logger.error(log, { error, ...context });

  return ActionResult.failure(`${fallback} ${SERVER_LOG_HINT}`);
}
