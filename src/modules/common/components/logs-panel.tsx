"use client";

import { EraserIcon } from "lucide-react";
import { useRef, useState, type UIEvent } from "react";
import { StreamOutput, StreamReconnectButton, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useStreamText } from "#modules/common/hooks/use-stream-text.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
import { Button } from "#modules/common/ui/button.tsx";

/** The followed logs of a sheet and their toolbar; a new mount, as when the sheet opens, starts from the tail. */
export function LogsPanel({ endpoint }: { endpoint: string }) {
  const { t } = useTranslation(CommonMessages);
  const [following, setFollowing] = useState(true);
  const { text: logs, status, error, clear, reconnect } = useStreamText(endpoint);
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

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StreamStatusBadge status={status} />
        <StreamReconnectButton
          status={status}
          onReconnect={() => {
            // Back to following the tail: the scroll position starts over.
            lastScrollTop.current = 0;
            setFollowing(true);
            reconnect();
          }}
        />
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <EraserIcon data-icon="inline-start" />
          {t("logs.clear")}
        </Button>
        {!following && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setFollowing(true)}>
            {t("logs.resume")}
          </Button>
        )}
      </div>

      <StreamOutput
        text={logs}
        error={error}
        placeholder={t("logs.waiting")}
        follow={following}
        onScroll={handleScroll}
      />
    </>
  );
}
