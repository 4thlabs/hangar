import { cn } from "cn";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ComposeService } from "#libs/docker";
import { ContainerStatus } from "#modules/apps/components/container-status.tsx";
import { ContainerStreamButton } from "#modules/apps/components/container-stream-button.tsx";
import { formatBytes, formatPercent } from "#modules/apps/format.ts";
import { EMPTY_METRICS, type ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import type { ProjectServices } from "#modules/apps/project-services.ts";
import { StatusDot, statusLabel } from "#modules/apps/status.ts";

type ServiceListProps = {
  project: string;
  /** `null` until Docker is first read */
  services: ProjectServices | null;
  stats: ContainerStats;
  /** The service whose containers are unfolded, if any */
  expandedService: string | null;
  onSelect: (service: string) => void;
};

/** An app's services and their live state, each unfolding into its containers with their logs or console. */
export function ServiceList({ project, services, stats, expandedService, onSelect }: ServiceListProps) {
  return (
    <section aria-label="Services de l’app" className="flex flex-col gap-1 rounded-lg border border-input p-1.5">
      <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">Services</p>
      {services === null && <p className="px-2 pb-1 text-sm text-muted-foreground">Lecture de Docker…</p>}
      {services?.state === "unavailable" && <p className="px-2 pb-1 text-sm text-destructive">Docker indisponible.</p>}
      {services?.state === "absent" && (
        <p className="px-2 pb-1 text-sm text-muted-foreground">Aucun conteneur : l’app n’est pas démarrée.</p>
      )}
      {services?.state === "loaded" && (
        <ul className="flex flex-col">
          {services.detail.services.map(service => (
            <ServiceRow
              key={service.name}
              project={project}
              service={service}
              stats={stats}
              isExpanded={service.name === expandedService}
              onSelect={() => onSelect(service.name)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type ServiceRowProps = {
  project: string;
  service: ComposeService;
  stats: ContainerStats;
  isExpanded: boolean;
  onSelect: () => void;
};

function ServiceRow({ project, service, stats, isExpanded, onSelect }: ServiceRowProps) {
  const Chevron = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <li>
      <button
        type="button"
        aria-expanded={isExpanded}
        title={statusLabel[service.status]}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0"
        onClick={onSelect}
      >
        <Chevron />
        <span className={cn("size-2 shrink-0 rounded-full", StatusDot.Class[service.status])} aria-hidden />
        <span className="truncate">{service.name}</span>
        <span className="ml-auto pl-1.5 text-xs tabular-nums">
          {service.runningCount}/{service.containers.length}
        </span>
      </button>
      {isExpanded && (
        <ul className="flex flex-col gap-1 py-1 pl-6">
          {service.containers.map(container => {
            const metrics = stats[container.id] ?? EMPTY_METRICS;

            return (
              <li key={container.id} className="flex flex-col gap-1 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium" title={container.name}>
                    {container.name}
                  </span>
                  <span className="ml-auto shrink-0">
                    <ContainerStatus container={container} />
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                  <span>{formatPercent(metrics.cpuPercent)}</span>
                  <span>{formatBytes(metrics.memoryUsage)}</span>
                  <span className="ml-auto">
                    <ContainerStreamButton project={project} container={container} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
