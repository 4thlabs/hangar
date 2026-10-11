import { PencilIcon } from "lucide-react";
import { Link } from "waku";
import { type HangarApp } from "#libs/hangar";
import { Badge } from "#modules/common/ui/badge.tsx";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardTitle } from "#modules/common/ui/card.tsx";
import { StartAppButton } from "#modules/store/components/start-app-button.tsx";
import { SwarmDeployButton } from "#modules/store/components/swarm-deploy-button.tsx";

type StoreAppCardProps = {
  app: HangarApp;
};

/**
 * Server component: only the buttons below are interactive. Compose and swarm are two independent
 * buttons; what runs is for the Apps and Cluster pages to show, and to stop.
 */
export function StoreAppCard({ app }: StoreAppCardProps) {
  return (
    <Card className="relative gap-2 py-3">
      <Link
        to={`/store/${app.id}/edit`}
        aria-label={`Modifier ${app.name}`}
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
          <Badge variant="outline" title="A un compose.swarm.yml : elle peut aussi tourner dans le swarm">
            Swarm
          </Badge>
        )}
      </CardContent>
      {app.swarmReady && <SwarmDeployButton appId={app.id} appName={app.name} />}
      <StartAppButton appId={app.id} appName={app.name} />
    </Card>
  );
}
