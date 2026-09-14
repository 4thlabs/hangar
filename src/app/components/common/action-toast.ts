import type { ActionResult } from "#app/actions/action-result.ts";

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

export function createTransportErrorToast(
  title: string,
  description = "Impossible de contacter le serveur. Réessayez.",
) {
  return {
    title,
    description,
    type: "error" as const,
  };
}
