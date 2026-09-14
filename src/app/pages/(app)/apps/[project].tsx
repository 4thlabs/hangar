import { BoxIcon } from "lucide-react";
import { Link } from "waku";
import type { PageProps } from "waku/router";
import { AppDetail } from "#app/components/apps/app-detail.tsx";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#app/components/ui/empty.tsx";
import { DockerNotFoundError, getComposeProjectDetail } from "#libs/docker";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

export default async function AppDetailPage({ project }: PageProps<"/apps/[project]">) {
  try {
    // Without the stats sample: it costs 1-2s and would delay first paint by that much.
    // `AppDetail` polls on mount, so the metrics land a moment after the page is usable.
    const initialData = await getComposeProjectDetail(
      hangar.runtime,
      project,
      hangar.store.installedProjectIds(),
      false,
    );

    return (
      <main>
        <title>{project} | Apps | Hangar</title>
        <AppDetail initialData={initialData} />
      </main>
    );
  } catch (error) {
    if (!(error instanceof DockerNotFoundError)) {
      logger.error({ error, project }, "Failed to render Docker Compose project");
    }

    return (
      <main>
        <title>{project} | Apps | Hangar</title>
        {error instanceof DockerNotFoundError ? (
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
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Docker indisponible</AlertTitle>
            <AlertDescription>
              Impossible de charger cette application. Vérifiez le socket Docker et ses permissions.
            </AlertDescription>
          </Alert>
        )}
      </main>
    );
  }
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
