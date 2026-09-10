import type { ReactNode } from "react";
import { Card } from "#app/components/card/accent-card.tsx";
import { CardContent, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Skeleton } from "#app/components/ui/skeleton.tsx";
import { cn } from "#libs/utils";

type WidgetSkeletonProps = {
  className: string;
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
    <Card className={cn("w-full", className)} aria-label={`Loading ${title}`} aria-busy="true">
      <CardHeader className={cn(withSubtitle && "gap-0 border-b")}>
        <CardTitle className="inline-flex items-center gap-1.5">
          {icon}
          {title}
        </CardTitle>
        {withSubtitle && <Skeleton className="h-4 w-40 max-w-full" />}
      </CardHeader>
      <CardContent className="flex flex-1 items-center">
        <Skeleton className="h-2 w-full" />
      </CardContent>
      {withFooter && (
        <CardFooter className="flex-col items-start gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-48 max-w-full" />
        </CardFooter>
      )}
    </Card>
  );
}
