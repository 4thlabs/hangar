export type AppOperation = "up" | "down" | "recreate";

export const isAppOperation = (value: string): value is AppOperation =>
  value === "up" || value === "down" || value === "recreate";

/** Button/toast label for each operation, shared by the table and the detail page. */
export const actionLabel: Record<AppOperation, string> = {
  up: "Up",
  down: "Down",
  recreate: "Force recreate",
};
