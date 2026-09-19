import type { PageProps } from "waku/router";
import { AppsOverview } from "#app/components/apps/apps-overview.tsx";
import { appsSearchCodec } from "#app/search-codecs.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { outdatedProjects } from "#libs/jobs";
import { logger } from "#libs/logs";

export default async function AppsPage({ search }: PageProps<"/apps">) {
  let snapshot: ComposeProjectsSnapshot | null = null;
  let error: string | null = null;

  try {
    const [projects, outdated] = await Promise.all([docker.listProjects(), outdatedProjects()]);
    const categories = hangar.config.categories();
    // Nothing stops a stack from being listed twice: the first match wins, as it does for Arcane tags.
    // Only the name and colour travel to the client; the stack list would be dead weight on every row.
    const categoryOf = (stack: string) => {
      const found = categories.find(category => category.stacks.includes(stack));

      return found && { name: found.name, color: found.color };
    };

    snapshot = {
      projects: projects.projects.map(p => ({
        ...p,
        updateAvailable: outdated.has(p.name),
        icon: hangar.store.app(p.name)?.icon,
        category: categoryOf(p.name),
      })),
    };
  } catch (failure) {
    logger.error("Failed to render Docker Compose projects", { error: failure });
    error = "Le daemon Docker est indisponible. Vérifiez le socket et ses permissions.";
  }

  return (
    <main>
      <title>Apps | Hangar</title>
      <AppsOverview snapshot={snapshot} error={error} search={search} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: appsSearchCodec,
  } as const;
};
