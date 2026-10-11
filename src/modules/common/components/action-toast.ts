import type { ActionResult } from "#modules/common/actions/action-result.ts";

type ActionToastTitles = {
  success: string;
  error: string;
};

export function createActionToast(result: ActionResult, titles: ActionToastTitles) {
  return {
    title: result.success ? titles.success : titles.error,
    description: result.message,
    type: result.success ? ("success" as const) : ("error" as const),
  };
}

/** What a toast or a panel says when a server action never returned. */
export const TRANSPORT_ERROR_MESSAGE = "Impossible de contacter le serveur. Réessayez.";

export function createTransportErrorToast(title: string, description = TRANSPORT_ERROR_MESSAGE) {
  return {
    title,
    description,
    type: "error" as const,
  };
}
