"use client";

import { lazy, Suspense } from "react";
import { useInBrowser } from "#modules/common/hooks/use-in-browser.ts";
import { Spinner } from "#modules/common/ui/spinner.tsx";

// Fetched with xterm and its stylesheet once the page runs in the browser: xterm touches `window` on load,
// so the server render must not import it.
const TerminalPanel = lazy(() =>
  import("#modules/common/components/terminal-panel.tsx").then(module => ({ default: module.TerminalPanel })),
);

/** A shell on the host, filling the rest of the page; it opens on arrival and closes on leaving. */
export function HostTerminal() {
  const inBrowser = useInBrowser();

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Terminal du serveur">
      {inBrowser ? (
        <Suspense fallback={<Spinner />}>
          <TerminalPanel endpoint="/api/host/terminal" />
        </Suspense>
      ) : (
        <Spinner />
      )}
    </section>
  );
}
