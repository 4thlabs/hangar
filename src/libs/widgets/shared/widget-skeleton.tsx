import type { ReactNode } from "react";
import { Skeleton } from "#app/components/ui/skeleton.tsx";
import { WidgetCard, WidgetContent, WidgetHeader } from "./widget.tsx";

type WidgetSkeletonProps = {
  className?: string | undefined;
  icon: ReactNode;
  title: string;
};

/**
 * Placeholder for a widget that cannot render yet: a cold cache on the first render after a
 * start, or a service that is down and never fills one. Warm widgets never get a boundary at
 * all — see `Warm` — so this is not worth shaping per widget; it only has to hold the card's
 * size and say what is loading.
 */
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
