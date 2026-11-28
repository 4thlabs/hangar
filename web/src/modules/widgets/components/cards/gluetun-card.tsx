import { cn } from "cn";
import type { GluetunVpnStatus } from "#libs/api";
import { LoadedWidget } from "#modules/widgets/components/loaded-widget.tsx";
import { WidgetCard, WidgetContent, WidgetHeader } from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";

/** `gluetun-vpn-status`: whether gluetun's tunnel is up, and where it exits. */
export const gluetunWidget = defineWidget("gluetun-vpn-status", {
  icon: WidgetIcon.dashboard("gluetun"),
  className: "min-h-32",
  title: m.widgets_gluetun_vpn_status_title,
  errorDescription: m.widgets_gluetun_vpn_status_error_description,
  card: GluetunWidget,
});

/** The card, with what it loaded of `GET /widgets/{key}`, in its own region. */
function GluetunWidget({ placement }: WidgetProps) {
  return (
    <LoadedWidget placement={placement} type="gluetun-vpn-status" look={widgetLook(gluetunWidget)}>
      {status => <GluetunCard status={status} />}
    </LoadedWidget>
  );
}

/** Whether gluetun's tunnel is up, and where it comes out. No link: gluetun has no web page. */
export function GluetunCard({ status: { publicIp, city, country } }: { status: GluetunVpnStatus }) {
  const look = widgetLook(gluetunWidget);
  // gluetun answers without an address while the tunnel is down.
  const isConnected = publicIp.length > 0;
  const location = [city, country].filter(part => part.length > 0).join(", ");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader bordered icon={look.icon} title={look.title} />

      <WidgetContent className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          <span className={cn(!isConnected && "text-destructive")}>
            {isConnected ? m.widgets_gluetun_connected() : m.widgets_gluetun_disconnected()}
          </span>
          {/* Decorative: the sentence says the same. */}
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", isConnected ? "bg-primary" : "bg-destructive")}
          />
        </p>

        {/* One line: an address without the city it comes out in is half an answer. */}
        {isConnected && (
          <p className="truncate tabular-nums text-muted-foreground">
            {[publicIp, location].filter(part => part.length > 0).join(" - ")}
          </p>
        )}
      </WidgetContent>
    </WidgetCard>
  );
}
