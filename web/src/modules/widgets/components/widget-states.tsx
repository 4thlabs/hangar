import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import type { WidgetLook } from "#modules/widgets/widget-appearance.ts";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

/** The card of a widget whose data is not in yet, of the size it will have. */
export function WidgetSkeleton({ look }: { look: WidgetLook }) {
  return (
    <WidgetCard className={look.className} aria-label={`Loading ${look.title}`} aria-busy="true">
      <WidgetHeader icon={look.icon} title={look.title} />
      <WidgetContent className="flex flex-1 items-center">
        <Skeleton className="h-2 w-full" />
      </WidgetContent>
    </WidgetCard>
  );
}

/** The card of a widget that could not load: its service did not answer, and the rest of the dashboard stands. */
export function WidgetError({ look, reason }: { look: WidgetLook; reason?: string | undefined }) {
  return (
    <WidgetCard className={look.className}>
      <WidgetHeader bordered icon={look.icon} title={look.title} />
      <WidgetContent className="flex flex-1 items-center">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{look.title} is unavailable</AlertTitle>
          <AlertDescription>
            {look.errorDescription}
            {reason && <span className="block">{reason}</span>}
          </AlertDescription>
        </Alert>
      </WidgetContent>
    </WidgetCard>
  );
}
