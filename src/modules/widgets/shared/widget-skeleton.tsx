import { Translation } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import type { WidgetIcon } from "../config/config.ts";
import { WidgetsMessages } from "./messages.ts";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

type WidgetSkeletonProps = {
  className?: string | undefined;
  icon: WidgetIcon;
  title: string;
  locale: LocaleCode;
};

/** Placeholder holding the card's size while its cache is cold; a warm widget renders inline and never shows it. */
export function WidgetSkeleton({ className, icon, title, locale }: WidgetSkeletonProps) {
  const t = Translation.create(WidgetsMessages, locale);

  return (
    <WidgetCard className={className} aria-label={t("loading", { title })} aria-busy="true">
      <WidgetHeader icon={icon} title={title} />
      <WidgetContent className="flex flex-1 items-center">
        <Skeleton className="h-2 w-full" />
      </WidgetContent>
    </WidgetCard>
  );
}
