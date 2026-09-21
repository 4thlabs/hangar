import { cn } from "cn";
import type { GluetunPublicIp } from "./api/client.ts";
import { createGluetunClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import { WidgetCard, WidgetContent, WidgetHeader } from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type GluetunVpnStatusCardProps = {
  publicIp: GluetunPublicIp;
};

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
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
          {/* The dot repeats what the sentence already says: colour alone is never the status. */}
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

/**
 * Whether the tunnel is up, and where it comes out.
 *
 * No header link: gluetun's control server answers JSON and nothing else, and the stack carries no
 * Traefik router, so there is no page to send anyone to.
 */
export const gluetunVpnStatus = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "gluetun-vpn-status",
    ttl,
    ...chrome,
    errorDescription: "The VPN status could not be read.",
    load: async () => (await createGluetunClient(service)).getPublicIp(),
    render: (publicIp: GluetunPublicIp) => <GluetunVpnStatusCard publicIp={publicIp} />,
  });
