import type { ReactNode } from "react";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

type WidgetSkeletonProps = {
  className?: string | undefined;
  icon: ReactNode;
  title: string;
};

/** Placeholder holding the card's size while its cache is cold; a warm widget renders inline and never shows it. */
export function WidgetSkeleton({ className, icon, title }: WidgetSkeletonProps) {
  return (
    <WidgetCard className={className} aria-label={`Loading ${title}`} aria-busy="true">
      <WidgetHeader icon={icon} title={title} />
      <WidgetContent className="flex flex-1 items-center">
        <Skeleton className="h-2 w-full" />
      </WidgetContent>
    </WidgetCard>
  );
}
