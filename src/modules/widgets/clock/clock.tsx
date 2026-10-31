import type { WidgetBody } from "../shared/define-widget.tsx";
import { ClockDisplay } from "./clock-display.tsx";
import { clockDescriptor } from "./descriptor.ts";

/** The date and time, ticking in the browser: the card loads nothing. */
export const clockWidget: WidgetBody<null> = {
  load: () => Promise.resolve(null),
  render: (_data, _placementKey, locale) => (
    <ClockDisplay className={clockDescriptor.appearance.className} locale={locale} />
  ),
};
