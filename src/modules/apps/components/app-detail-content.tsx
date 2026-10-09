import { BoxIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "waku";
import { all, map, recover } from "#libs/cache";
import { DockerNotFoundError } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { logger } from "#libs/logs";
import { AppDetail } from "#modules/apps/components/app-detail.tsx";
import { AppsSnapshot } from "#modules/apps/snapshots.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#modules/common/ui/empty.tsx";

/** Docker half of `/apps/[project]`, a child so a cold read suspends inside the boundary (see `AppsContent`). */
export function AppDetailContent({ project }: { project: string }): Promise<ReactNode> {
  const detail = map(all([docker.projectDetail(project), AppsSnapshot.outdated()]), ([loaded, outdated]) => (
    <AppDetail detail={{ ...loaded, updateAvailable: outdated.has(project) }} />
  ));

  return recover(detail, (error: unknown) => {
    // An app that is not there is an answer, not a failure: nothing to log.
    if (error instanceof DockerNotFoundError) {
      return <AppNotFound project={project} />;
    }

    logger.error("Failed to render Docker Compose project", { error, project });

    return (
      <Alert variant="destructive">
        <AlertTitle>Docker indisponible</AlertTitle>
        <AlertDescription>
          Impossible de charger cette application. Vérifiez le socket Docker et ses permissions.
        </AlertDescription>
      </Alert>
    );
  });
}

function AppNotFound({ project }: { project: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BoxIcon />
        </EmptyMedia>
        <EmptyTitle>Application introuvable</EmptyTitle>
        <EmptyDescription>
          Aucun conteneur Docker Compose ne porte actuellement le label « {project} ».
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/apps">Retour aux apps</Link>} />
      </EmptyContent>
    </Empty>
  );
}
