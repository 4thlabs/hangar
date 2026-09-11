"use client";

import { useState, useTransition } from "react";
import { CircleCheckIcon, DownloadIcon } from "lucide-react";
import type { InstallAppResult } from "#app/actions/install-app.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardTitle } from "#app/components/ui/card.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { toast } from "#app/components/ui/toast.tsx";

type StoreAppCardProps = {
  app: {
    id: string;
    name: string;
    icon: string;
    installed: boolean;
  };
  installApp: (appId: string) => Promise<InstallAppResult>;
};

export function StoreAppCard({ app, installApp }: StoreAppCardProps) {
  const [installed, setInstalled] = useState(app.installed);
  const [isPending, startTransition] = useTransition();

  function handleInstall() {
    startTransition(async () => {
      try {
        const result = await installApp(app.id);
        setInstalled(result.installed);
        toast.add({
          title: result.success ? "Application installée" : "Échec de l’installation",
          description: result.message,
          type: result.success ? "success" : "error",
        });
      } catch {
        toast.add({
          title: "Échec de l’installation",
          description: "Impossible de contacter le serveur. Réessayez.",
          type: "error",
        });
      }
    });
  }

  const installLabel = isPending ? `Installation de ${app.name}` : `Installer ${app.name}`;
  const installTitle = isPending ? "Installation…" : "Installer";
  const installIcon = isPending ? <Spinner /> : <DownloadIcon />;

  return (
    <Card className="relative w-38 gap-2 py-3">
      <CardContent className="flex flex-col items-center gap-2 px-2 text-center">
        <img src={app.icon} alt="" className="size-12 object-contain" />
        <CardTitle className="line-clamp-2 text-base leading-tight">
          {app.name}
        </CardTitle>
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
