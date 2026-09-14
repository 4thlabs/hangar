import { dockerRoute } from "#app/api/docker-route.ts";
import { dockerOk, listComposeProjects } from "#libs/docker";
import { hangar } from "#libs/hangar/server";

export const GET = dockerRoute(
  { log: "Failed to list Docker Compose projects", unavailable: "Le daemon Docker est indisponible." },
  async () => dockerOk(await listComposeProjects(hangar.runtime, hangar.store.installedProjectIds())),
);
