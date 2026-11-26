import { ComposeDialogs, ComposeOperationButtons } from "#modules/apps/components/compose-operations.tsx";
import { RunningBatches } from "#modules/apps/components/running-batches.tsx";
import { useComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";

/** The compose commands of an app's page, and the batches that run on it. */
export function ProjectActions({ project }: { project: string }) {
  const compose = useComposeCommand([project]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ComposeOperationButtons compose={compose} />
      </div>
      <RunningBatches compose={compose} project={project} />
      <ComposeDialogs compose={compose} subject={project} count={1} />
    </div>
  );
}
