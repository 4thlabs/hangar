"use client";

import { type UIEvent, useEffect, useRef } from "react";
import { type StreamStatus, streamStatusLabel } from "#app/hooks/use-stream-text.ts";
import { Badge } from "#app/components/ui/badge.tsx";

/** Where a `useStreamText` stream stands, for a sheet header. */
export function StreamStatusBadge({ status }: { status: StreamStatus }) {
  return <Badge variant={status === "error" ? "destructive" : "secondary"}>{streamStatusLabel[status]}</Badge>;
}

type StreamOutputProps = {
  text: string;
  error: string | null;
  /** Shown until the first chunk arrives. */
  placeholder: string;
  /** Keep the tail in view as text arrives. */
  follow?: boolean;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
};

/** The streamed text of a sheet (compose output, container logs), scrolled to its tail while following. */
export function StreamOutput({ text, error, placeholder, follow = true, onScroll }: StreamOutputProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && follow) viewport.scrollTop = viewport.scrollHeight;
  }, [follow, text]);

  return (
    <>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div ref={viewportRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3">
        <pre className="font-mono text-xs whitespace-pre-wrap">{text || placeholder}</pre>
      </div>
    </>
  );
}
