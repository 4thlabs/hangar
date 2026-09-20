import { Suspense } from "react";
import { BoxIcon } from "lucide-react";
import { Link } from "waku";
import type { PageProps } from "waku/router";
import { AppDetail } from "#app/components/apps/app-detail.tsx";
import { PageSpinner } from "#app/components/common/page-spinner.tsx";
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
import { DockerNotFoundError } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { outdatedProjects } from "#libs/jobs";
import { logger } from "#libs/logs";

/**
 * The Docker half of the page, kept as a child so the `await` happens inside the boundary below
 * rather than in the page itself — see `apps.tsx` for why that distinction is the whole point.
 */
async function AppDetailContent({ project }: { project: string }) {
  try {
    const [detail, outdated] = await Promise.all([docker.projectDetail(project), outdatedProjects()]);

    return <AppDetail detail={{ ...detail, updateAvailable: outdated.has(project) }} />;
  } catch (error) {
    if (!(error instanceof DockerNotFoundError)) {
      logger.error("Failed to render Docker Compose project", { error, project });
    }

    return error instanceof DockerNotFoundError ? (
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
    );
  }
}

export default function AppDetailPage({ project }: PageProps<"/apps/[project]">) {
  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>{`${project} | Apps | Hangar`}</title>
      {/* Keyed by the project, so the boundary is a new one on every arrival — see `apps.tsx`.
          Detail to detail is the same case as the list to here. */}
      <Suspense key={project} fallback={<PageSpinner />}>
        <AppDetailContent project={project} />
      </Suspense>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
