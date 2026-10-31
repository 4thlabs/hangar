import type { ComposeProjectStatus } from "#libs/docker";

export const statusVariant = (status: ComposeProjectStatus) => {
  if (status === "unhealthy") {
    return "destructive" as const;
  }

  if (status === "partial") {
    return "outline" as const;
  }

  return "secondary" as const;
};

/** How a service runs, as its dot draws it: a Compose status, or `missing` for one with no container yet. */
export type ServiceTone = ComposeProjectStatus | "missing";

export class StatusDot {
  /** The dot before a service: filled by its status, hollow when it has no container. */
  static readonly Class: Record<ServiceTone, string> = {
    running: "bg-emerald-500",
    partial: "bg-amber-500",
    stopped: "bg-muted-foreground/60",
    unhealthy: "bg-destructive",
    missing: "border border-muted-foreground",
  };
}
