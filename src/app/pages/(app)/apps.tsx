import type { PageProps } from "waku/router";
import { manageApp } from "#app/actions/apps/manage-app.ts";
import { AppsOverview } from "#app/components/apps/apps-overview.tsx";
import { appsSearchCodec } from "#app/search-codecs.ts";
import { listComposeProjects, type ComposeProjectsSnapshot } from "#libs/docker/projects.ts";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

export default async function AppsPage({ search }: PageProps<"/apps">) {
  let snapshot: ComposeProjectsSnapshot | null = null;
  let error: string | null = null;

  try {
    snapshot = await listComposeProjects(hangar.store.installedProjectIds());
  } catch (failure) {
    logger.error({ error: failure }, "Failed to render Docker Compose projects");
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
