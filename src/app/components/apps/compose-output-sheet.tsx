"use client";

import { useEffect, useRef } from "react";
import { composeExitCode } from "#app/actions/apps/compose-stream.ts";
import { type AppOperation } from "#app/actions/apps/app-operation.ts";
import { useStreamText } from "#app/hooks/use-stream-text.ts";
import { plural } from "#app/components/apps/format.ts";
import { StreamOutput, StreamStatusBadge } from "#app/components/common/stream-output.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#app/components/ui/sheet.tsx";

type ComposeOutputSheetProps = {
  /** The apps the command runs over, in order. */
  projects: string[];
  /** The running operation, or `null` when nothing runs and the sheet stays closed */
  operation: AppOperation | null;
  label: string;
  onClose: () => void;
  /** Called once when the command finished, with the number of failed apps (`null` if the stream broke) */
  onFinished: (code: number | null) => void;
};

export function ComposeOutputSheet({ projects, operation, label, onClose, onFinished }: ComposeOutputSheetProps) {
  const subject = projects.length === 1 ? projects[0] : plural(projects.length, "application");
  const endpoint =
    operation && projects.length > 0
      ? `/api/docker/apps/compose?operation=${operation}&projects=${projects.map(encodeURIComponent).join(",")}`
      : null;
  const { text, status, error } = useStreamText(endpoint, "POST");

  const finishedRef = useRef(false);
  useEffect(() => {
    if (status === "connecting" || status === "connected") finishedRef.current = false;
    if (finishedRef.current) return;

    if (status === "ended") {
      finishedRef.current = true;
      onFinished(composeExitCode(text));
    } else if (status === "error") {
      finishedRef.current = true;
      onFinished(null);
    }
  }, [onFinished, status, text]);

  return (
    <Sheet open={operation !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>
              {label} · {subject}
            </SheetTitle>
            <StreamStatusBadge status={status} />
          </div>
          <SheetDescription>
            Sortie de Docker Compose en direct. Fermer ce panneau n’interrompt rien : les commandes vont à leur terme
            côté serveur et chacune dépose une notification.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <StreamOutput text={text} error={error} placeholder="Démarrage de la commande…" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
