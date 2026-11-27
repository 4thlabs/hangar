import { TerminalIcon } from "lucide-react";
import type { ComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { composeLabel, composeSubject } from "#modules/common/helpers/compose-actions.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { m } from "#paraglide/messages.js";

type RunningBatchesProps = {
  compose: ComposeCommand;
  /** The app whose page this is, whose batches alone are shown; every batch on the list of apps. */
  project?: string;
};

/**
 * The batches the server runs, for a page that comes back while one does, or whose panel was closed: each opens the
 * panel on its output, from its start. None is listed while the panel is open.
 */
export function RunningBatches({ compose, project }: RunningBatchesProps) {
  const running = compose.running.filter(batch => project === undefined || batch.apps.includes(project));

  if (running.length === 0 || compose.shown !== null) {
    return null;
  }

  return (
    <ul className="flex flex-col gap-2">
      {running.map(batch => (
        <li key={batch.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <Spinner />
          <span>
            {m.apps_compose_runs_on({ label: composeLabel(batch.action), subject: composeSubject(batch.apps) })}{" "}
            <span className="font-mono text-muted-foreground">{batch.commandLine}</span>
          </span>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => compose.show(batch)}>
            <TerminalIcon data-icon="inline-start" />
            {m.apps_compose_show_output()}
          </Button>
        </li>
      ))}
    </ul>
  );
}
