import { ClockIcon } from "lucide-react";
import { ClockDisplay } from "./clock-display.tsx";
import { defineWidget } from "../shared/define-widget.tsx";

const clockWidgetClassName = "h-20";

/**
 * The date and time, ticking in the browser.
 *
 * Nothing to load — the clock reads the visitor's own clock — but it still goes
 * through `defineWidget` so its id, title, icon and size are declared once and
 * it gets the same skeleton as every other widget.
 */
export const clockWidget = defineWidget({
  id: "clock",
  title: "Clock",
  icon: <ClockIcon />,
  className: clockWidgetClassName,
  errorDescription: "The clock could not be rendered.",
  load: () => Promise.resolve(null),
  render: () => <ClockDisplay className={clockWidgetClassName} />,
});
