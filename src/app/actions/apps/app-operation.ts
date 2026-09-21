export type AppOperation = "up" | "down" | "recreate" | "update";

export const isAppOperation = (value: string): value is AppOperation =>
  value === "up" || value === "down" || value === "recreate" || value === "update";

/** Button/toast label for each operation, shared by the table and the detail page. */
export const actionLabel: Record<AppOperation, string> = {
  up: "Up",
  down: "Down",
  recreate: "Force recreate",
  update: "Mettre à jour",
};

/** What each operation did to an app, for the notification filed when the command ends. */
export const operationOutcome: Record<AppOperation, (project: string) => string> = {
  up: project => `${project} a été démarrée ou mise à jour.`,
  down: project => `${project} a été arrêtée et supprimée.`,
  recreate: project => `${project} a été recréée.`,
  update: project => `${project} a été mise à jour depuis son registre.`,
};
