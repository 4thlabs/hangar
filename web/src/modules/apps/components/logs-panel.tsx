import { EraserIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { useLogEvents } from "#modules/apps/hooks/use-log-events.ts";
import { appsMessages } from "#modules/apps/messages.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

const words = appsMessages.logs;

/** How close to the bottom the reader counts as there, in pixels. */
const bottomSlack = 32;

/** The followed log of a container and its toolbar; a new mount, as when its sheet opens, starts from the tail. */
export function LogsPanel({ url }: { url: string }) {
  const { lines, status, error, clear, reconnect } = useLogEvents(url);
  const [following, setFollowing] = useState(true);
  const lastScrollTop = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewport.current && following) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [following, lines]);

  /**
   * Following stops when the reader scrolls up, and resumes at the bottom. A scroll event lands after the lines may
   * have grown again, so the distance to the bottom alone would read a burst, as the first 200, as the reader leaving.
   */
  function handleScroll({ currentTarget }: UIEvent<HTMLDivElement>) {
    const isAtBottom = currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight < bottomSlack;

    const scrolledUp = currentTarget.scrollTop < lastScrollTop.current;

    lastScrollTop.current = currentTarget.scrollTop;

    if (isAtBottom) {
      setFollowing(true);
    } else if (scrolledUp) {
      setFollowing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "error" ? "destructive" : "secondary"}>{words.status[status]}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status === "connecting"}
          onClick={() => {
            // Back to following the tail: the scroll position starts over.
            lastScrollTop.current = 0;
            setFollowing(true);
            reconnect();
          }}
        >
          {status === "connecting" ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
          {words.reconnect}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <EraserIcon data-icon="inline-start" />
          {words.clear}
        </Button>
        {!following && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setFollowing(true)}>
            {words.resume}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div ref={viewport} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3">
        <pre className="font-mono text-xs whitespace-pre-wrap">
          {lines.length > 0 ? lines.join("\n") : words.waiting}
        </pre>
      </div>
    </>
  );
}
