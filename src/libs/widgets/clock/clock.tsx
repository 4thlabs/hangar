"use client";

import { useEffect, useState } from "react";
import { ClockIcon } from "lucide-react";
import { CardContent } from "#app/components/ui/card";
import { cn } from "#libs/utils";
import { WidgetSkeleton } from "../shared/index.ts";
import { Card } from "#app/components/card/accent-card.tsx";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const clockWidgetClassName = "h-20 w-full";

export function ClockSkeleton() {
  return <WidgetSkeleton className={clockWidgetClassName} icon={<ClockIcon />} title="Clock" />;
}

export function ClockWidget() {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const updateClock = () => setNow(new Date());

    updateClock();
    const interval = window.setInterval(updateClock, 1_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <Card className={cn(clockWidgetClassName, "justify-center py-0 font-mono")}>
      <CardContent className="flex items-center justify-between">
        <div className="flex flex-col gap-0">
          <p className="flex items-baseline gap-4 text-lg font-semibold">
            <span className="tabular-nums">{now.getDate()}</span>
            <span>{monthFormatter.format(now)}</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{now.getFullYear()}</p>
        </div>

        <div className="flex flex-col items-end gap-0">
          <time className="text-lg font-semibold tabular-nums" dateTime={now.toISOString()}>
            {timeFormatter.format(now)}
          </time>
          <p className="text-sm text-muted-foreground">{weekdayFormatter.format(now)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
