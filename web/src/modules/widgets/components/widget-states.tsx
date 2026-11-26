import { CircleAlertIcon } from "lucide-react";
import { RetryButton } from "#modules/common/components/region.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import type { WidgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
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

type WidgetErrorProps = {
  look: WidgetLook;
  reason?: string | undefined;
  /** Reads the widget again, its region's retry. */
  retry?: (() => void) | undefined;
};

/** The card of a widget that could not load: its service did not answer, and the rest of the dashboard stands. */
export function WidgetError({ look, reason, retry }: WidgetErrorProps) {
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
          {retry && (
            <AlertAction>
              <RetryButton retry={retry} />
            </AlertAction>
          )}
        </Alert>
      </WidgetContent>
    </WidgetCard>
  );
}

/** The card of a widget that threw as it rendered, on data its service gave in a shape it does not expect. */
export function WidgetCardFailure({ look, retry }: { look: WidgetLook; retry: () => void }) {
  return <WidgetError look={look} reason="The card could not show what its service answered." retry={retry} />;
}
