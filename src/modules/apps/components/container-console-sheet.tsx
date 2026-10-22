"use client";

import { SquareTerminalIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { LogsPanel } from "#modules/common/components/logs-panel.tsx";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";

// Fetched with xterm and its stylesheet when the Terminal tab is first opened, not with every app page.
const TerminalPanel = lazy(() =>
  import("#modules/apps/components/terminal-panel.tsx").then(module => ({ default: module.TerminalPanel })),
);

type ContainerConsoleSheetProps = {
  /** The container's routes, under which `/logs` and `/terminal` live. */
  endpoint: string;
  name: string;
  /** Where it runs: its app and short id. */
  context: string;
};

/** A button opening a running container's console: its live logs, and a shell in a second tab. */
export function ContainerConsoleSheet({ endpoint, name, context }: ContainerConsoleSheetProps) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="xs" aria-label={`Ouvrir la console de ${name}`}>
            <SquareTerminalIcon data-icon="inline-start" />
            Console
          </Button>
        }
      />
      {/* As wide as `LogsSheet`: log lines are long, and so is a terminal's. */}
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-[90vw] data-[side=right]:sm:max-w-7xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{name}</SheetTitle>
          <SheetDescription>{context}</SheetDescription>
        </SheetHeader>

        <ConsoleTabs endpoint={endpoint} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The logs and the terminal, side by side, both kept mounted until the sheet closes: a glance at the logs
 * must not kill what the shell runs. The shell opens the first time its tab is selected.
 */
function ConsoleTabs({ endpoint }: { endpoint: string }) {
  const [terminalOpened, setTerminalOpened] = useState(false);

  return (
    <Tabs
      defaultValue="logs"
      onValueChange={value => setTerminalOpened(opened => opened || value === "terminal")}
      className="min-h-0 flex-1 px-4 pb-4"
    >
      <TabsList>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="terminal">Terminal</TabsTrigger>
      </TabsList>
      <TabsContent value="logs" keepMounted className="flex min-h-0 flex-col gap-3">
        <LogsPanel endpoint={`${endpoint}/logs`} />
      </TabsContent>
      <TabsContent value="terminal" keepMounted className="flex min-h-0 flex-col gap-3">
        {terminalOpened && (
          <Suspense fallback={<Spinner />}>
            <TerminalPanel endpoint={`${endpoint}/terminal`} />
          </Suspense>
        )}
      </TabsContent>
    </Tabs>
  );
}
