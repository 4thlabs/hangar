import type { SwarmNodeAvailability, SwarmNodeRole, SwarmNodeStatus, SwarmStackHealth } from "#libs/docker";

export const roleLabel: Record<SwarmNodeRole, string> = {
  leader: "Leader",
  manager: "Manager",
  worker: "Worker",
};

export const nodeStatusLabel: Record<SwarmNodeStatus, string> = {
  ready: "Prêt",
  down: "Injoignable",
  unknown: "Inconnu",
  disconnected: "Déconnecté",
};

export const availabilityLabel: Record<SwarmNodeAvailability, string> = {
  active: "Actif",
  pause: "En pause",
  drain: "Drainé",
};

export const healthLabel: Record<SwarmStackHealth, string> = {
  running: "Tous les réplicas tournent",
  partial: "Une partie des réplicas tourne",
  stopped: "Aucun réplica ne tourne",
};

/** The dot before a stack: full, half or empty, as its replicas run. */
export const healthSymbol: Record<SwarmStackHealth, string> = {
  running: "●",
  partial: "◐",
  stopped: "○",
};

export const healthClass: Record<SwarmStackHealth, string> = {
  running: "text-emerald-600 dark:text-emerald-400",
  partial: "text-amber-600 dark:text-amber-400",
  stopped: "text-destructive",
};

/** A node the managers cannot reach reads as a fault; one they hear from, as a plain fact. */
export const nodeStatusVariant = (status: SwarmNodeStatus) => (status === "ready" ? "secondary" : "destructive");

/** A drained or paused node takes no new task, which deserves to stand out. */
export const availabilityVariant = (availability: SwarmNodeAvailability) =>
  availability === "active" ? "secondary" : "outline";
