import type { ComposeContainer } from "#libs/docker";
import { ContainerConsoleSheet } from "#modules/apps/components/container-console-sheet.tsx";
import { LogsSheet } from "#modules/common/components/logs-sheet.tsx";

type ContainerStreamButtonProps = { project: string; container: ComposeContainer };

/** The console of a running container, or the logs of one that is not: Docker only runs an exec in a running one. */
export function ContainerStreamButton({ project, container }: ContainerStreamButtonProps) {
  const endpoint = `/api/docker/apps/${encodeURIComponent(project)}/containers/${encodeURIComponent(container.id)}`;
  const context = `${project} · ${container.id.slice(0, 12)}`;

  if (container.state === "running") {
    return <ContainerConsoleSheet endpoint={endpoint} name={container.name} context={context} />;
  }

  return <LogsSheet endpoint={`${endpoint}/logs`} name={container.name} context={context} />;
}
