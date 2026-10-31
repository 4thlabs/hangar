import type { ActionResult } from "#modules/common/actions/action-result.ts";

type ActionToastTitles = {
  success: string;
  error: string;
};

/** The toasts a server action ends with. */
export class ActionToast {
  /** The outcome of an action that returned, successful or not. */
  static create(result: ActionResult, titles: ActionToastTitles) {
    return {
      title: result.success ? titles.success : titles.error,
      description: result.message,
      type: result.success ? ("success" as const) : ("error" as const),
    };
  }

  /**
   * An action that never returned: the request itself failed.
   * @param description Why, in the reader's language: `CommonMessages` `actions.transportError` unless the action
   * knows better
   */
  static transportError(title: string, description: string) {
    return {
      title,
      description,
      type: "error" as const,
    };
  }
}
