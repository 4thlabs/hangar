"use client";

import { useTransition } from "react";
import type { ActionResult } from "#app/actions/action-result.ts";
import { createActionToast, createTransportErrorToast } from "#app/components/common/action-toast.ts";
import { toast } from "#app/components/ui/toast.tsx";

type ActionToastTitles = {
  success: string;
  error: string;
  /** Body of the transport-failure toast, when the default "contact the server" wording is wrong. */
  transport?: string;
};

/**
 * Runs a server action in a transition and toasts its outcome, including the case the action
 * never came back at all — a rejected call is a transport failure, not a failed operation, and
 * the two need different wording.
 *
 * `run` takes something returning an `ActionResult` and nothing more: callers that aggregate
 * several results, or that read an outcome off a stream, build their `ActionResult` first and pass
 * a function returning it. Titles are per call, not per hook, so they may depend on state set in
 * the same event — a hook-level closure would still hold the previous render's value.
 */
export function useServerAction() {
  const [isPending, startTransition] = useTransition();

  /**
   * @param action The call to run
   * @param titles Toast wording for this call
   * @param onSettled Runs after the toast, whether the action succeeded, failed or never returned
   */
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
      } catch {
        toast.add(createTransportErrorToast(titles.error, titles.transport));
      }

      await onSettled?.(result);
    });

  return { run, isPending };
}
