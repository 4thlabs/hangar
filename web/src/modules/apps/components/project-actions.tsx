import { ComposeOperationButtons } from "#modules/apps/components/compose-operations.tsx";
import { RunningBatches } from "#modules/apps/components/running-batches.tsx";
import type { ComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";

type ProjectActionsProps = {
  compose: ComposeCommand;
  project: string;
};

/** The compose buttons of an app's page, and the batches that run on it; the page holds their dialogs. */
export function ProjectActions({ compose, project }: ProjectActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ComposeOperationButtons compose={compose} />
      </div>
      <RunningBatches compose={compose} project={project} />
    </div>
  );
}
