import type { ApiContext } from "waku/router";
import { dockerRoute } from "#app/api/docker-route.ts";
import { dockerOk, getComposeProjectDetail } from "#libs/docker";
import { hangar } from "#libs/hangar/server";

export const GET = dockerRoute<ApiContext<"/api/docker/apps/[project]">>(
  {
    log: "Failed to inspect Docker Compose project",
    unavailable: "Le daemon Docker est indisponible.",
    notFound: "Cette application Docker n’existe plus.",
  },
  async (_request, { params }) =>
    dockerOk(await getComposeProjectDetail(hangar.runtime, params.project, hangar.store.installedProjectIds())),
);
