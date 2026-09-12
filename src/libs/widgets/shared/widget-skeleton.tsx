import type { ReactNode } from "react";
import { Skeleton } from "#app/components/ui/skeleton.tsx";
import { WidgetCard, WidgetContent, WidgetFooter, WidgetHeader } from "./widget.tsx";

type WidgetSkeletonProps = {
  className?: string | undefined;
  icon: ReactNode;
  title: string;
  withFooter?: boolean;
  withSubtitle?: boolean;
};

export function WidgetSkeleton({
  className,
  icon,
  title,
  withFooter = false,
  withSubtitle = false,
}: WidgetSkeletonProps) {
  return (
    <WidgetCard className={className} aria-label={`Loading ${title}`} aria-busy="true">
      <WidgetHeader
        description={withSubtitle ? <Skeleton className="h-4 w-40 max-w-full" /> : undefined}
        icon={icon}
        title={title}
      />
      <WidgetContent className="flex flex-1 items-center">
        <Skeleton className="h-2 w-full" />
      </WidgetContent>
      {withFooter && (
        <WidgetFooter title={<Skeleton className="h-3 w-28" />}>
          <Skeleton className="h-4 w-48 max-w-full" />
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}
