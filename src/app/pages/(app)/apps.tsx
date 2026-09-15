import type { PageProps } from "waku/router";
import { manageApp } from "#app/actions/apps/manage-app.ts";
import { AppsOverview } from "#app/components/apps/apps-overview.tsx";
import { appsSearchCodec } from "#app/search-codecs.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker/compose.ts";
import { docker } from "#libs/docker/server";
import { outdatedProjects } from "#libs/jobs/server";
import { logger } from "#libs/logs";

export default async function AppsPage({ search }: PageProps<"/apps">) {
  let snapshot: ComposeProjectsSnapshot | null = null;
  let error: string | null = null;

  try {
    const [projects, outdated] = await Promise.all([docker.listProjects(), outdatedProjects()]);

    snapshot = { projects: projects.projects.map(p => ({ ...p, updateAvailable: outdated.has(p.name) })) };
  } catch (failure) {
    logger.error("Failed to render Docker Compose projects", { error: failure });
    error = "Le daemon Docker est indisponible. Vérifiez le socket et ses permissions.";
  }

  return (
    <main>
      <title>Apps | Hangar</title>
      <AppsOverview snapshot={snapshot} error={error} manageApp={manageApp} search={search} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: appsSearchCodec,
  } as const;
};
