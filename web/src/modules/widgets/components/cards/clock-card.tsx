import { cn } from "cn";
import { useEffect, useState } from "react";
import { widgetLook } from "#modules/widgets/widget-appearance.ts";
import { WidgetCard, WidgetContent } from "../widget.tsx";

// How the clock writes the time, the month and the day.

const timeFormat = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const monthFormat = new Intl.DateTimeFormat("en", { month: "long" });

const weekdayFormat = new Intl.DateTimeFormat("en", { weekday: "long" });

/** The date and time, from the reader's own clock, each second. */
export function ClockCard() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <WidgetCard className={cn(widgetLook("clock").className, "justify-center py-0 font-mono")}>
      <WidgetContent className="flex items-center justify-between">
        <div className="flex flex-col gap-0">
          <p className="flex items-baseline gap-4 text-lg font-semibold">
            <span className="tabular-nums">{now.getDate()}</span>
            <span>{monthFormat.format(now)}</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{now.getFullYear()}</p>
        </div>

        <div className="flex flex-col items-end gap-0">
          <time className="text-lg font-semibold tabular-nums" dateTime={now.toISOString()}>
            {timeFormat.format(now)}
          </time>
          <p className="text-sm text-muted-foreground">{weekdayFormat.format(now)}</p>
        </div>
      </WidgetContent>
    </WidgetCard>
  );
}
