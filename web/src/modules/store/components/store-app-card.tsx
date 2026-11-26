import { Link } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import type { StoreApp } from "#libs/api";
import { Badge } from "#modules/common/ui/badge.tsx";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardTitle } from "#modules/common/ui/card.tsx";
import { StoreAppButton } from "#modules/store/components/store-app-button.tsx";

type StoreAppCardProps = {
  app: StoreApp;
};

/** An app of the store: its editor, its icon, its name, whether it can run in the swarm, and its install or uninstall. */
export function StoreAppCard({ app }: StoreAppCardProps) {
  return (
    <Card className="relative gap-2 py-3">
      <Link
        to="/store/$id/edit"
        params={{ id: app.id }}
        aria-label={`Edit ${app.name}`}
        className={buttonVariants({
          variant: "ghost",
          size: "icon-xs",
          className: "absolute top-1.5 left-1.5 text-muted-foreground",
        })}
      >
        <PencilIcon />
      </Link>
      <CardContent className="flex flex-col items-center gap-2 px-2 text-center">
        {app.icon ? (
          <img src={app.icon} alt="" className="size-12 object-contain" />
        ) : (
          <div className="size-12 rounded-sm bg-muted" aria-hidden="true" />
        )}
        <CardTitle className="line-clamp-2 text-base leading-tight">{app.name}</CardTitle>
        {app.swarmReady && (
          <Badge variant="outline" title="Has a compose.swarm.yml: once installed, it deploys from the Cluster page">
            Swarm
          </Badge>
        )}
      </CardContent>
      <StoreAppButton app={app} />
    </Card>
  );
}
