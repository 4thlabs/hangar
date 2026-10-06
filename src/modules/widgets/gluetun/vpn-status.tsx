import { cn } from "cn";
import { IconSelfh } from "#modules/common/components/icon-selfh.tsx";
import type { WidgetService } from "../config/config.ts";
import { defineWidget } from "../shared/define-widget.tsx";
import { WidgetCard, WidgetContent, WidgetHeader } from "../shared/index.ts";
import { GluetunClient, type GluetunPublicIp } from "./api/client.ts";

type GluetunVpnStatusCardProps = {
  publicIp: GluetunPublicIp;
};

const chrome = { title: "Gluetun", icon: <IconSelfh name="gluetun" />, className: "min-h-32" };

export function GluetunVpnStatusCard({ publicIp }: GluetunVpnStatusCardProps) {
  const { public_ip: address, city, country } = publicIp;
  // gluetun answers 200 with an empty address while the tunnel is down.
  const connected = address.length > 0;
  const location = [city, country].filter(part => part.length > 0).join(", ");

  return (
    <WidgetCard className={chrome.className}>
      <WidgetHeader bordered icon={chrome.icon} title={chrome.title} />

      <WidgetContent className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          <span className={cn(!connected && "text-destructive")}>
            Your VPN is {connected ? "connected" : "not connected"}!
          </span>
          {/* Decorative: the sentence says the same. */}
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", connected ? "bg-primary" : "bg-destructive")}
          />
        </p>

        {/* One line, not two: an address without the city it comes out in is half an answer. */}
        {connected && (
          <p className="truncate tabular-nums text-muted-foreground">
            {[address, location].filter(part => part.length > 0).join(" - ")}
          </p>
        )}
      </WidgetContent>
    </WidgetCard>
  );
}

/** Whether the tunnel is up, and where it comes out. No header link: gluetun has no web page. */
export const gluetunVpnStatus = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "gluetun-vpn-status",
    ttl,
    ...chrome,
    errorDescription: "The VPN status could not be read.",
    load: async () => (await GluetunClient.connect(service)).getPublicIp(),
    render: (publicIp: GluetunPublicIp) => <GluetunVpnStatusCard publicIp={publicIp} />,
  });
