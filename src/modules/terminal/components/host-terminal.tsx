"use client";

import { lazy, Suspense } from "react";
import { useInBrowser } from "#modules/common/hooks/use-in-browser.ts";
import { Spinner } from "#modules/common/ui/spinner.tsx";

// Fetched with xterm and its stylesheet once the page runs in the browser: xterm touches `window` on load,
// so the server render must not import it.
const TerminalPanel = lazy(() =>
  import("#modules/common/components/terminal-panel.tsx").then(module => ({ default: module.TerminalPanel })),
);

/** The user's shell on the host, as tall as most of the screen, less on a short one; it outlives the page. */
export function HostTerminal() {
  const inBrowser = useInBrowser();

  return (
    <section className="flex h-[70svh] min-h-0 flex-col gap-3" aria-label="Terminal du serveur">
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
