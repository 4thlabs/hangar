import type { ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Card } from "#app/components/card/accent-card.tsx";
import { CardContent, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { cn } from "#libs/utils";

type WidgetErrorProps = {
  className: string;
  description: string;
  icon: ReactNode;
  name: string;
};

export function WidgetError({ className, description, icon, name }: WidgetErrorProps) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="border-b">
        <CardTitle className="inline-flex items-center gap-1.5">
          {icon}
          {name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{name} is unavailable</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
