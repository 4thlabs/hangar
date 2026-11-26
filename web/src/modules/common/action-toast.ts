import { ErrorMessage } from "#modules/common/error-message.ts";
import { toast } from "#modules/common/ui/toast.tsx";

/** The toasts a change ends with: what was done, or why it was not. */
export class ActionToast {
  /** A change that went through: `title`, and what it did. */
  static success(title: string, description?: string) {
    toast.add({ title, description, type: "success" });
  }

  /** A change that failed: `title`, and why, as the server says it. */
  static failure(title: string, error: unknown) {
    toast.add({ title, description: ErrorMessage.of(error), type: "error" });
  }
}
