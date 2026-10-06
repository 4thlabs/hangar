"use client";

import { EraserIcon, FileTextIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { StreamOutput, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useStreamText } from "#modules/common/hooks/use-stream-text.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#modules/common/ui/sheet.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type ContainerLogsSheetProps = {
  project: string;
  containerId: string;
  containerName: string;
};

export function ContainerLogsSheet({ project, containerId, containerName }: ContainerLogsSheetProps) {
  const [open, setOpen] = useState(false);
  const [following, setFollowing] = useState(true);

  const endpoint = open
    ? `/api/docker/apps/${encodeURIComponent(project)}/containers/${encodeURIComponent(containerId)}/logs`
    : null;

  const { text: logs, status, error, clear, reconnect } = useStreamText(endpoint);

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
            <StreamStatusBadge status={status} />
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setFollowing(true)}>
                Reprendre le suivi
              </Button>
            )}
          </div>

          <StreamOutput
            text={logs}
            error={error}
            placeholder="En attente de logs…"
            follow={following}
            onScroll={({ currentTarget: v }) => setFollowing(v.scrollHeight - v.scrollTop - v.clientHeight < 32)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
