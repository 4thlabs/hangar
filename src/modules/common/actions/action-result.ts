export type ActionResult = {
  success: boolean;
  message: string;
};

export const ActionResult = {
  success(message: string): ActionResult {
    return { success: true, message };
  },
  failure(message: string): ActionResult {
    return { success: false, message };
  },
};

/** A server action that reads something: its value when it succeeded, why not otherwise. */
export type ReadResult<T> = { success: true; value: T } | { success: false; message: string };
