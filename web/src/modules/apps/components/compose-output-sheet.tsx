import { useEffect, useRef } from "react";
import { ComposeActions } from "#modules/apps/compose-actions.ts";
import type { AppRun, AppRunStatus } from "#modules/apps/compose-output.ts";
import type { ComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import type { ComposeStreamStatus } from "#modules/apps/hooks/use-compose-stream.ts";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#modules/common/ui/sheet.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** What the panel says of each state, of the stream and of each app. */
class ComposeOutputView {
  static readonly StreamLabels: Readonly<Record<ComposeStreamStatus, string>> = {
    connecting: "Connecting…",
    connected: "Live",
    ended: "Done",
    error: "Error",
  };

  static readonly AppLabels: Readonly<Record<AppRunStatus, string>> = {
    waiting: "Waiting",
    running: "Running",
    succeeded: "Succeeded",
    failed: "Failed",
    not_run: "Not run",
  };

  static variant(status: AppRunStatus): "secondary" | "outline" | "destructive" | "default" {
    switch (status) {
      case "failed":
      case "not_run":
        return "destructive";
      case "succeeded":
        return "default";
      case "waiting":
        return "outline";
      case "running":
        return "secondary";
    }
  }
}

/** One app of the batch: its name, how the command is going on it, why it failed, and its lines. */
function AppRunSection({ run }: { run: AppRun }) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={run.app}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-medium">{run.app}</h3>
        <Badge variant={ComposeOutputView.variant(run.status)}>
          {run.status === "running" && <Spinner />}
          {ComposeOutputView.AppLabels[run.status]}
        </Badge>
      </div>
      {run.error && <p className="text-sm text-destructive">{ErrorMessage.describeDetail(run.error)}</p>}
      {run.lines.length > 0 && (
        <pre className="rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{run.lines.join("\n")}</pre>
      )}
    </section>
  );
}

/**
 * The output of the batch `compose` shows, app by app in the order they run, kept at its tail as it comes. Closing it
 * stops nothing: the batch runs to its end on the server, which notifies each app's.
 */
export function ComposeOutputSheet({ compose }: { compose: ComposeCommand }) {
  const { shown, output, status, error } = compose;
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [output]);

  return (
    <Sheet open={shown !== null} onOpenChange={isOpen => !isOpen && compose.close()}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>
              {shown ? `${ComposeActions.label(shown.action)} · ${ComposeActions.subject(shown.apps)}` : ""}
            </SheetTitle>
            <Badge variant={status === "error" ? "destructive" : "secondary"}>
              {ComposeOutputView.StreamLabels[status]}
            </Badge>
          </div>
          <SheetDescription>
            {shown && <span className="font-mono">{ComposeActions.commandLine(shown.action)}</span>} · Closing this
            panel interrupts nothing: the command runs to its end on the server, and each app files a notification.
          </SheetDescription>
        </SheetHeader>
        <div ref={viewport} className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {output.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              The start of the output is no longer kept: {output.skipped} earlier events are left out.
            </p>
          )}
          {output.apps.map(run => (
            <AppRunSection key={run.app} run={run} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
