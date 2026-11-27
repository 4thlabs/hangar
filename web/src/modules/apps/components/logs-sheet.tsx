import { FileTextIcon } from "lucide-react";
import { getDockerLogsUrl, type ProjectContainer } from "#libs/api";
import { LogsPanel } from "#modules/apps/components/logs-panel.tsx";
import { appsMessages } from "#modules/apps/messages.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#modules/common/ui/sheet.tsx";

const words = appsMessages.logs;

type LogsSheetProps = {
  project: string;
  container: ProjectContainer;
};

/**
 * A button that opens the live log of a container of `project`: its last 200 lines, then followed, read only while
 * the sheet is open. The console of a running container comes with the terminal.
 */
export function LogsSheet({ project, container }: LogsSheetProps) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="xs" aria-label={words.open({ name: container.name })}>
            <FileTextIcon data-icon="inline-start" />
            {words.button}
          </Button>
        }
      />
      {/* The whole screen on a phone, most of it above: log lines are long. The `data-[side=right]` prefix is the
          sheet's own, which a bare `sm:max-w-*` would not override. */}
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-[90vw] data-[side=right]:sm:max-w-7xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{words.title({ name: container.name })}</SheetTitle>
          <SheetDescription>
            {project} · {container.id.slice(0, 12)} · {words.tail}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <LogsPanel url={getDockerLogsUrl(project, container.id)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
