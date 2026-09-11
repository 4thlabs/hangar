import type { ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

type WidgetErrorProps = {
  className: string;
  description: string;
  icon: ReactNode;
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
