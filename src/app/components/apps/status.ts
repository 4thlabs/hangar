import type { ComposeProjectStatus } from "#libs/docker/compose.ts";

export const statusLabel: Record<ComposeProjectStatus, string> = {
  running: "En cours",
  partial: "Partiel",
  stopped: "Arrêté",
  unhealthy: "Dégradé",
};

export const statusVariant = (status: ComposeProjectStatus) => {
  if (status === "unhealthy") return "destructive" as const;
  if (status === "partial") return "outline" as const;
  return "secondary" as const;
};
