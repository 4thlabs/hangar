import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { StoreAppButton } from "#app/components/store/store-app-button.tsx";
import { Card, CardContent, CardTitle } from "#app/components/ui/card.tsx";
import { type HangarApp } from "#libs/hangar";

type StoreAppCardProps = {
  app: HangarApp;
  installApp: (appId: string) => Promise<StoreActionResult>;
  uninstallApp: (appId: string) => Promise<StoreActionResult>;
};

/** Server component: only the install button below is interactive. */
export function StoreAppCard({ app, installApp, uninstallApp }: StoreAppCardProps) {
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
      <StoreAppButton
        appId={app.id}
        appName={app.name}
        installed={app.installed}
        installApp={installApp}
        uninstallApp={uninstallApp}
      />
    </Card>
  );
}
