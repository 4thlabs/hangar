"use client";

import { useState, useTransition } from "react";
import { CircleCheckIcon, DownloadIcon } from "lucide-react";
import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { createStoreActionToast, createStoreTransportErrorToast } from "#app/components/store/store-action-toast.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardTitle } from "#app/components/ui/card.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { toast } from "#app/components/ui/toast.tsx";
import { type HangarApp } from "#libs/hangar";

type StoreAppCardProps = {
  app: HangarApp;
  installApp: (appId: string) => Promise<StoreActionResult>;
};

export function StoreAppCard({ app, installApp }: StoreAppCardProps) {
  const [installed, setInstalled] = useState(app.installed);
  const [isPending, startTransition] = useTransition();

  function handleInstall() {
    startTransition(async () => {
      try {
        const result = await installApp(app.id);
        setInstalled(result.installed);
        toast.add(
          createStoreActionToast(result, {
            success: "Application installée",
            error: "Échec de l’installation",
          }),
        );
      } catch {
        toast.add(createStoreTransportErrorToast("Échec de l’installation"));
      }
    });
  }

  const installLabel = isPending ? `Installation de ${app.name}` : `Installer ${app.name}`;
  const installTitle = isPending ? "Installation…" : "Installer";
  const installIcon = isPending ? <Spinner /> : <DownloadIcon />;

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
      {installed ? (
        <span
          role="status"
          aria-label={`${app.name} est installée`}
          className="absolute top-1.5 right-1.5 text-muted-foreground"
        >
          <CircleCheckIcon aria-hidden="true" className="size-4" />
        </span>
      ) : (
        <Button
          type="button"
          size="icon-xs"
          className="absolute top-1.5 right-1.5"
          disabled={isPending}
          onClick={handleInstall}
          aria-label={installLabel}
          title={installTitle}
        >
          {installIcon}
        </Button>
      )}
    </Card>
  );
}
