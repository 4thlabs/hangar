"use client";

import { useEffect, useRef } from "react";
import { composeExitCode } from "#app/actions/apps/compose-stream.ts";
import { type AppOperation } from "#app/actions/apps/app-operation.ts";
import { streamStatusLabel, useStreamText } from "#app/hooks/use-stream-text.ts";
import { plural } from "#app/components/apps/format.ts";
import { Badge } from "#app/components/ui/badge.tsx";
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const subject = projects.length === 1 ? projects[0] : plural(projects.length, "application");
  const endpoint =
    operation && projects.length > 0
      ? `/api/docker/apps/compose?operation=${operation}&projects=${projects.map(encodeURIComponent).join(",")}`
      : null;
  const { text, status, error } = useStreamText(endpoint, "POST");

  // Follow the output, it is short-lived and always worth showing the tail of.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [text]);

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
            <Badge variant={status === "error" ? "destructive" : "secondary"}>{streamStatusLabel[status]}</Badge>
          </div>
          <SheetDescription>
            Sortie de Docker Compose en direct. Fermer ce panneau n’interrompt rien : les commandes vont à leur terme
            côté serveur et chacune dépose une notification.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3">
            <pre className="font-mono text-xs whitespace-pre-wrap">{text || "Démarrage de la commande…"}</pre>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
