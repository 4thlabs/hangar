"use client";

import { EraserIcon, FileTextIcon, RefreshCwIcon } from "lucide-react";
import { useRef, useState, type UIEvent } from "react";
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

type LogsSheetProps = {
  /** The route streaming the logs, opened only while the sheet is. */
  endpoint: string;
  /** What the logs come from, a container or a service, in the trigger's label and the title. */
  name: string;
  /** Where it runs, before the reminder of what the stream shows. */
  context: string;
  /** The trigger's text; `Logs` by default. */
  label?: string;
};

/** A button opening the live logs of a container or a service: the last 200 lines, then followed. */
export function LogsSheet({ endpoint, name, context, label = "Logs" }: LogsSheetProps) {
  const [open, setOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const { text: logs, status, error, clear, reconnect } = useStreamText(open ? endpoint : null);
  const lastScrollTop = useRef(0);

  /**
   * Following stops when the reader scrolls up, and resumes at the bottom. A scroll event lands after the
   * text may have grown again, so the distance to the bottom alone would read a burst of lines, such as
   * the first 200, as the reader leaving.
   */
  function handleScroll({ currentTarget: viewport }: UIEvent<HTMLDivElement>) {
    const isAtBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32;
    const scrolledUp = viewport.scrollTop < lastScrollTop.current;

    lastScrollTop.current = viewport.scrollTop;

    if (isAtBottom) {
      setFollowing(true);
    } else if (scrolledUp) {
      setFollowing(false);
    }
  }

  /** Back to following the tail, as when the sheet opens: the scroll position starts over. */
  function followFromStart() {
    lastScrollTop.current = 0;
    setFollowing(true);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      clear();
      followFromStart();
    }

    setOpen(nextOpen);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button variant="outline" size="xs" aria-label={`Voir les logs de ${name}`}>
            <FileTextIcon data-icon="inline-start" />
            {label}
          </Button>
        }
      />
      {/* The full screen on a phone, most of it above: log lines are long. The `data-[side=right]` prefix
          is the sheet's own, which a bare `sm:max-w-*` would not override. */}
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-[90vw] data-[side=right]:sm:max-w-7xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>Logs de {name}</SheetTitle>
            <StreamStatusBadge status={status} />
          </div>
          <SheetDescription>{context} · 200 dernières lignes puis suivi en direct</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                followFromStart();
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
            onScroll={handleScroll}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
