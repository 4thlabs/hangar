import type { ActionResult } from "#modules/common/actions/action-result.ts";

type ActionToastTitles = {
  success: string;
  error: string;
};

/** The toasts a server action ends with. */
export class ActionToast {
  /** What a toast or a panel says when a server action never returned. */
  static readonly TransportErrorMessage = "Impossible de contacter le serveur. Réessayez.";

  /** The outcome of an action that returned, successful or not. */
  static of(result: ActionResult, titles: ActionToastTitles) {
    return {
      title: result.success ? titles.success : titles.error,
      description: result.message,
      type: result.success ? ("success" as const) : ("error" as const),
    };
  }

  /** An action that never returned: the request itself failed. */
  static transportError(title: string, description = ActionToast.TransportErrorMessage) {
    return {
      title,
      description,
      type: "error" as const,
    };
  }
}
