import type { PageProps } from "waku/router";
import { manageApp } from "#app/actions/apps/manage-app.ts";
import { AppsOverview } from "#app/components/apps/apps-overview.tsx";
import { appsSearchCodec } from "#app/search-codecs.ts";
import { listComposeProjects, type ComposeProjectsSnapshot } from "#libs/docker";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

export default async function AppsPage({ search }: PageProps<"/apps">) {
  let initialData: ComposeProjectsSnapshot | null = null;
  let initialError: string | null = null;

  try {
    initialData = await listComposeProjects(hangar.runtime, hangar.store.installedProjectIds());
  } catch (error) {
    logger.error({ error }, "Failed to render Docker Compose projects");
    initialError = "Le daemon Docker est indisponible. Vérifiez le socket et ses permissions.";
  }

  return (
    <main>
      <title>Apps | Hangar</title>
      <AppsOverview initialData={initialData} initialError={initialError} manageApp={manageApp} search={search} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: appsSearchCodec,
  } as const;
};
