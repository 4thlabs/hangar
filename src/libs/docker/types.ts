/** Aggregate run state of a Compose project or service. */
export type ComposeProjectStatus = "running" | "partial" | "stopped" | "unhealthy";

/** Docker healthcheck state of a single container. */
export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "none";

/** Lightweight per-project summary, cheap enough to compute for every project on the overview page. */
export type ComposeProjectSummary = {
  name: string;
  status: ComposeProjectStatus;
  serviceCount: number;
  containerCount: number;
  runningCount: number;
  stoppedCount: number;
  unhealthyCount: number;
};

/** Response body for the "list all projects" endpoint. */
export type ComposeProjectsSnapshot = {
  /** ISO timestamp the snapshot was taken at. */
  sampledAt: string;
  projects: ComposeProjectSummary[];
};

/** Point-in-time resource usage for a single container; a field is `null` when it could not be sampled. */
export type ContainerMetrics = {
  cpuPercent: number | null;
  memoryUsage: number | null;
  memoryLimit: number | null;
  memoryPercent: number | null;
  networkRx: number | null;
  networkTx: number | null;
  blockRead: number | null;
  blockWrite: number | null;
};

/** A single host↔container port mapping. */
export type PublishedPort = {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
};

/** Full detail for one container, as shown on the project detail page. */
export type ComposeContainer = {
  id: string;
  name: string;
  service: string;
  /** Compose replica index (`container-number` label), or `null` when absent/unparseable. */
  replica: number | null;
  image: string;
  state: string;
  health: ContainerHealth;
  restartCount: number | null;
  ports: PublishedPort[];
  metrics: ContainerMetrics;
  /** False when a live stats sample could not be taken (e.g. the container isn't running). */
  metricsAvailable: boolean;
};

/** One Compose service (a named group of container replicas) within a project. */
export type ComposeService = {
  name: string;
  status: ComposeProjectStatus;
  containerCount: number;
  runningCount: number;
  unhealthyCount: number;
  containers: ComposeContainer[];
};

/** Full detail for one Compose project, as shown on the project detail page. */
export type ComposeProjectDetail = ComposeProjectSummary & {
  sampledAt: string;
  services: ComposeService[];
  /** True when at least one container's inspection or stats sample failed. */
  partial: boolean;
};

/** Envelope every Docker API route responds with, success or failure. */
export type DockerApiResult<T> = { success: true; data: T } | { success: false; error: { message: string } };
