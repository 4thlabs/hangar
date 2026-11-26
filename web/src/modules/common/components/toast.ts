import { describeError } from "#modules/common/helpers/error-message.ts";
import { toast } from "#modules/common/ui/toast.tsx";

// The toasts a change ends with: what was done, or why it was not.

/** A change that went through: `title`, and what it did. */
export function toastSuccess(title: string, description?: string) {
  toast.add({ title, description, type: "success" });
}

/** A change that failed: `title`, and why, as the server says it. */
export function toastFailure(title: string, error: unknown) {
  toast.add({ title, description: describeError(error), type: "error" });
}
