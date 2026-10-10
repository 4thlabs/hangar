import { ActionResult } from "#modules/common/actions/action-result.ts";

/** A read of one app file: its content when it succeeded, why not otherwise. */
export type AppFileResult = ActionResult & { source?: string };

export const AppFileResult = {
  success(source: string): AppFileResult {
    return { ...ActionResult.success(""), source };
  },

  failure(message: string): AppFileResult {
    return ActionResult.failure(message);
  },
};
