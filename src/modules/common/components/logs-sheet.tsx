"use client";

import { FileTextIcon } from "lucide-react";
import { LogsPanel } from "#modules/common/components/logs-panel.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#modules/common/ui/sheet.tsx";

type LogsSheetProps = {
  /** The route streaming the logs, opened only while the sheet is. */
  endpoint: string;
  /** What the logs come from, a container or a service, in the trigger's label and the title. */
  name: string;
  /** Where it runs, before the reminder of what the stream shows. */
  context: string;
  /** The trigger's text; "Logs" in the reader's language by default. */
  label?: string;
};

/** A button opening the live logs of a container or a service: the last 200 lines, then followed. */
export function LogsSheet({ endpoint, name, context, label }: LogsSheetProps) {
  const { t } = useTranslation(CommonMessages);

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="xs" aria-label={t("logs.view", { name })}>
            <FileTextIcon data-icon="inline-start" />
            {label ?? t("logs.trigger")}
          </Button>
        }
      />
      {/* The full screen on a phone, most of it above: log lines are long. The `data-[side=right]` prefix
          is the sheet's own, which a bare `sm:max-w-*` would not override. */}
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-[90vw] data-[side=right]:sm:max-w-7xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{t("logs.title", { name })}</SheetTitle>
          <SheetDescription>
            {context} · {t("logs.tail")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          <LogsPanel endpoint={endpoint} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
