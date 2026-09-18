"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { WidgetCard, WidgetContent } from "../shared/index.ts";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long" });

/**
 * The only export of this module, and a component on purpose: every export of a
 * `"use client"` module crosses the RSC boundary as a client reference, so a
 * constant or an object would arrive as a proxy. The class name comes in as a
 * prop for the same reason — `clock.tsx` owns it, so the card and the skeleton
 * cannot drift apart.
 */
export function ClockDisplay({ className }: { className?: string | undefined }) {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const updateClock = () => setNow(new Date());

    updateClock();
    const interval = window.setInterval(updateClock, 1_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <WidgetCard className={cn(className, "justify-center py-0 font-mono")}>
      <WidgetContent className="flex items-center justify-between">
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
      </WidgetContent>
    </WidgetCard>
  );
}
