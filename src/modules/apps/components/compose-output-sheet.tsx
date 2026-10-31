"use client";

import { AppCommands, type AppCommand } from "#modules/apps/actions/app-operation.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import { StreamOutput, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useCommandStream } from "#modules/common/hooks/use-command-stream.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "#modules/common/ui/sheet.tsx";

type ComposeOutputSheetProps = {
  /** The apps the command runs over, in order. */
  projects: string[];
  /** The running command, or `null` when nothing runs and the sheet stays closed */
  command: AppCommand | null;
  onClose: () => void;
  /** Called once when the command finished, with the number of failed apps (`null` if the stream broke) */
  onFinished: (code: number | null) => void;
};

export function ComposeOutputSheet({ projects, command, onClose, onFinished }: ComposeOutputSheetProps) {
  const { t } = useTranslation(AppsMessages);
  const subject = projects.length === 1 ? projects[0] : t("apps", { count: projects.length });

  const endpoint =
    command && projects.length > 0
      ? `/api/docker/apps/compose?${AppCommands.query(command)}&projects=${projects.map(encodeURIComponent).join(",")}`
      : null;

  const { text, status, error } = useCommandStream(endpoint, onFinished);

  return (
    <Sheet open={command !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>
              {command ? AppCommands.label(command, t) : ""} · {subject}
            </SheetTitle>
            <StreamStatusBadge status={status} />
          </div>
          <SheetDescription>{t("commands.output.description")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <StreamOutput text={text} error={error} placeholder={t("commands.output.starting")} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
