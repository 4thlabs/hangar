/** Tail of every "something broke server-side" message: the details are in the log, not the UI. */
export const SERVER_LOG_HINT = "Consultez les logs du serveur.";

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
