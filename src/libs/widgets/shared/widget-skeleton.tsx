import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Skeleton } from "#app/components/ui/skeleton.tsx";
import { cn } from "#libs/utils";

type WidgetSkeletonProps = {
  className: string;
  icon: ReactNode;
  title: string;
};

export function WidgetSkeleton({ className, icon, title }: WidgetSkeletonProps) {
  return (
    <Card className={cn("w-full", className)} aria-label={`Loading ${title}`} aria-busy="true">
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-1.5">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center">
        <Skeleton className="h-2 w-full" />
      </CardContent>
    </Card>
  );
}
