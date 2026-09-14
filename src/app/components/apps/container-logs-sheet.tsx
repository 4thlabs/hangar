"use client";

import { useEffect, useRef, useState } from "react";
import { EraserIcon, FileTextIcon, RefreshCwIcon } from "lucide-react";
import { streamStatusLabel, useStreamText } from "#app/hooks/use-stream-text.ts";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#app/components/ui/sheet.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";

type ContainerLogsSheetProps = {
  project: string;
  containerId: string;
  containerName: string;
};

export function ContainerLogsSheet({ project, containerId, containerName }: ContainerLogsSheetProps) {
  const [open, setOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);

  const endpoint = open
    ? `/api/docker/apps/${encodeURIComponent(project)}/containers/${encodeURIComponent(containerId)}/logs`
    : null;
  const { text: logs, status, error, clear, reconnect } = useStreamText(endpoint);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && following) viewport.scrollTop = viewport.scrollHeight;
  }, [following, logs]);

  function handleScroll() {
    const viewport = viewportRef.current;
    if (viewport) {
      setFollowing(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32);
    }
  }

  function resumeFollowing() {
    setFollowing(true);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      clear();
      setFollowing(true);
    }
    setOpen(nextOpen);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button variant="outline" size="xs" aria-label={`Voir les logs de ${containerName}`}>
            <FileTextIcon data-icon="inline-start" />
            Logs
          </Button>
        }
      />
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>Logs de {containerName}</SheetTitle>
            <Badge variant={status === "error" ? "destructive" : "secondary"}>{streamStatusLabel[status]}</Badge>
          </div>
          <SheetDescription>
            {project} · {containerId.slice(0, 12)} · 200 dernières lignes puis suivi en direct
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFollowing(true);
                reconnect();
              }}
              disabled={status === "connecting"}
            >
              {status === "connecting" ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
              Reconnecter
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <EraserIcon data-icon="inline-start" />
              Effacer
            </Button>
            {!following && (
              <Button type="button" variant="ghost" size="sm" onClick={resumeFollowing}>
                Reprendre le suivi
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div
            ref={viewportRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3"
          >
            <pre className="font-mono text-xs whitespace-pre-wrap">{logs || "En attente de logs…"}</pre>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
