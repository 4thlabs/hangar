import { cn } from "cn";
import type { GluetunVpnStatus } from "#libs/api";
import { WidgetCard, WidgetContent, WidgetHeader } from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";

/** Whether gluetun's tunnel is up, and where it comes out. No link: gluetun has no web page. */
export function GluetunCard({ status: { publicIp, city, country } }: { status: GluetunVpnStatus }) {
  const look = widgetLook("gluetun-vpn-status");
  // gluetun answers without an address while the tunnel is down.
  const isConnected = publicIp.length > 0;
  const location = [city, country].filter(part => part.length > 0).join(", ");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader bordered icon={look.icon} title={look.title} />

      <WidgetContent className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          <span className={cn(!isConnected && "text-destructive")}>
            {isConnected ? "Your VPN is connected!" : "Your VPN is not connected!"}
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
