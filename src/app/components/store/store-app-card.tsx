import { CircleCheckIcon } from "lucide-react";
import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { StoreInstallButton } from "#app/components/store/store-install-button.tsx";
import { Card, CardContent, CardTitle } from "#app/components/ui/card.tsx";
import { type HangarApp } from "#libs/hangar";

type StoreAppCardProps = {
  app: HangarApp;
  installApp: (appId: string) => Promise<StoreActionResult>;
};

/** Server component: only the install button below is interactive. */
export function StoreAppCard({ app, installApp }: StoreAppCardProps) {
  return (
    <Card className="relative w-38 gap-2 py-3">
      <CardContent className="flex flex-col items-center gap-2 px-2 text-center">
        {app.icon ? (
          <img src={app.icon} alt="" className="size-12 object-contain" />
        ) : (
          <div className="size-12 rounded-sm bg-muted" aria-hidden="true" />
        )}
        <CardTitle className="line-clamp-2 text-base leading-tight">{app.name}</CardTitle>
      </CardContent>
      {app.installed ? (
        <span
          role="status"
          aria-label={`${app.name} est installée`}
          className="absolute top-1.5 right-1.5 text-muted-foreground"
        >
          <CircleCheckIcon aria-hidden="true" className="size-4" />
        </span>
      ) : (
        <StoreInstallButton appId={app.id} appName={app.name} installApp={installApp} />
      )}
    </Card>
  );
}
