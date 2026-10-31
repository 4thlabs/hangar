import { CircleAlertIcon } from "lucide-react";
import { Translation } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import type { WidgetIcon } from "../config/config.ts";
import { WidgetsMessages } from "./messages.ts";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

type WidgetErrorProps = {
  className?: string | undefined;
  description: string;
  icon: WidgetIcon;
  name: string;
  locale: LocaleCode;
};

export function WidgetError({ className, description, icon, name, locale }: WidgetErrorProps) {
  const t = Translation.create(WidgetsMessages, locale);

  return (
    <WidgetCard className={className}>
      <WidgetHeader bordered icon={icon} title={name} />
      <WidgetContent className="flex flex-1 items-center">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("unavailable", { title: name })}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
      </WidgetContent>
    </WidgetCard>
  );
}
