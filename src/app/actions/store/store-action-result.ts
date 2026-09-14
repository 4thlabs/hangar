import { ActionResult } from "#app/actions/action-result.ts";

export type StoreActionResult = ActionResult & { installed: boolean };

export const StoreActionResult = {
  success(message: string, installed = true): StoreActionResult {
    return { ...ActionResult.success(message), installed };
  },

  failure(message: string, installed = false): StoreActionResult {
    return { ...ActionResult.failure(message), installed };
  },
};
