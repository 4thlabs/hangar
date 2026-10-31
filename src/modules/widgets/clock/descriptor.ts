import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { ClockMessages } from "./messages.ts";

/** The date and time, ticking in the browser: no service, nothing to cache. */
export const clockDescriptor = describeWidget({
  schema: WidgetSchema.local("clock"),
  appearance: {
    messages: ClockMessages,
    // Dashboard Icons draws apps, not a plain clock: Fluent Emoji's alarm clock (MIT), served by Hangar itself.
    icon: new WidgetIcon("/images/widgets/clock.svg"),
    className: "h-20",
  },
  module: () => import("./clock.tsx"),
  create: ({ clockWidget }) => clockWidget,
});
