"use client";

import { useState, useTransition } from "react";
import { ActionToast } from "#modules/common/components/action-toast.ts";
import { toast } from "#modules/common/ui/toast.tsx";
import { unfilledVariables } from "#modules/store/actions/store-apps.ts";
import { UnfilledNote } from "#modules/store/unfilled-note.ts";

/**
 * Asks the server which of an app's variables are still empty, before it starts or deploys, and holds
 * the confirmation that names them. A failed read is toasted and goes no further: starting blind is what
 * the check is there to avoid.
 */
export function useUnfilledVariables(appId: string) {
  const [isChecking, startTransition] = useTransition();

  /** The empty variables the open confirmation names; `null` while it is closed. */
  const [unfilled, setUnfilled] = useState<string[] | null>(null);

  /** Runs `then` with the empty variables, none included, once the server answers. */
  const check = (then: (variables: string[]) => void) =>
    startTransition(async () => {
      try {
        const result = await unfilledVariables(appId);

        if (!result.success) {
          toast.add(ActionToast.transportError(UnfilledNote.CheckFailedTitle, result.message));

          return;
        }

        then(result.value);
      } catch (error) {
        console.error("Server action failed", error);
        toast.add(ActionToast.transportError(UnfilledNote.CheckFailedTitle));
      }
    });

  return { check, isChecking, unfilled, confirm: setUnfilled, dismiss: () => setUnfilled(null) };
}
