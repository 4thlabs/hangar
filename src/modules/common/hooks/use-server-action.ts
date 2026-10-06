"use client";

import { useTransition } from "react";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { createActionToast, createTransportErrorToast } from "#modules/common/components/action-toast.ts";
import { toast } from "#modules/common/ui/toast.tsx";

type ActionToastTitles = {
  success: string;
  error: string;
  /** Body of the transport-failure toast, when the default "contact the server" wording is wrong. */
  transport?: string;
};

/**
 * Runs a server action in a transition and toasts its outcome. A rejected call is a transport failure,
 * not a failed operation, and gets its own wording.
 */
export function useServerAction() {
  const [isPending, startTransition] = useTransition();

  /** `onSettled` runs after the toast, whether the action succeeded, failed or never returned. */
  const run = <R extends ActionResult>(
    action: () => Promise<R>,
    titles: ActionToastTitles,
    onSettled?: (result: R | null) => void | Promise<void>,
  ) =>
    startTransition(async () => {
      let result: R | null = null;

      try {
        result = await action();
        toast.add(createActionToast(result, titles));
      } catch (error) {
        // The toast only says the request failed; the cause is for whoever opens the console.
        console.error("Server action failed", error);
        toast.add(createTransportErrorToast(titles.error, titles.transport));
      }

      await onSettled?.(result);
    });

  return { run, isPending };
}
