import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import type { WidgetIcon } from "../config/config.ts";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

type WidgetErrorProps = {
  className?: string | undefined;
  description: string;
  icon: WidgetIcon;
  name: string;
};

export function WidgetError({ className, description, icon, name }: WidgetErrorProps) {
  return (
    <WidgetCard className={className}>
      <WidgetHeader bordered icon={icon} title={name} />
      <WidgetContent className="flex flex-1 items-center">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{name} is unavailable</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
      </WidgetContent>
    </WidgetCard>
  );
}
