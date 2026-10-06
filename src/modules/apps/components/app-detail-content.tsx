import { BoxIcon } from "lucide-react";
import { Link } from "waku";
import { AppDetail } from "#modules/apps/components/app-detail.tsx";
import { outdatedSnapshot } from "#modules/apps/snapshots.ts";
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
import { DockerNotFoundError } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { logger } from "#libs/logs";

/** Docker half of `/apps/[project]`, a child so the `await` happens inside the boundary (see `AppsContent`). */
export async function AppDetailContent({ project }: { project: string }) {
  try {
    const [detail, outdated] = await Promise.all([docker.projectDetail(project), outdatedSnapshot.read()]);

    return <AppDetail detail={{ ...detail, updateAvailable: outdated.has(project) }} />;
  } catch (error) {
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
  }
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
