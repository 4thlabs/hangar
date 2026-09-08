"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "#app/components/ui/card";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long" });

export function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const updateClock = () => setNow(new Date());

    updateClock();
    const interval = window.setInterval(updateClock, 1_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <Card className="h-20 w-full justify-center py-0 font-mono">
      <CardContent className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline gap-4 text-lg font-semibold">
            <span className="tabular-nums">{now ? now.getDate() : "--"}</span>
            <span>{now ? monthFormatter.format(now) : "--------"}</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{now ? now.getFullYear() : "----"}</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <time className="text-lg font-semibold tabular-nums" dateTime={now?.toISOString()}>
            {now ? timeFormatter.format(now) : "--:--"}
          </time>
          <p className="text-sm text-muted-foreground">{now ? weekdayFormatter.format(now) : "--------"}</p>
        </div>
      </CardContent>
    </Card>
  );
}
