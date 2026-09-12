import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";

type StoreActionTitles = {
  success: string;
  error: string;
};

export function createStoreActionToast(result: StoreActionResult, titles: StoreActionTitles) {
  return {
    title: result.success ? titles.success : titles.error,
    description: result.message,
    type: result.success ? ("success" as const) : ("error" as const),
  };
}

export function createStoreTransportErrorToast(title: string) {
  return {
    title,
    description: "Impossible de contacter le serveur. Réessayez.",
    type: "error" as const,
  };
}
