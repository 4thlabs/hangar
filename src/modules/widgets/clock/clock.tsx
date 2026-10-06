import { ClockIcon } from "lucide-react";
import { defineWidget } from "../shared/define-widget.tsx";
import { ClockDisplay } from "./clock-display.tsx";

const clockWidgetClassName = "h-20";

/** The date and time, ticking in the browser. Loads nothing, but goes through `defineWidget` for its skeleton. */
export const clockWidget = defineWidget({
  id: "clock",
  title: "Clock",
  icon: <ClockIcon />,
  className: clockWidgetClassName,
  errorDescription: "The clock could not be rendered.",
  load: () => Promise.resolve(null),
  render: () => <ClockDisplay className={clockWidgetClassName} />,
});
