import { queryOptions, type QueryKey } from "@tanstack/react-query";
import {
  dockerOverview,
  getComposeBatchesQueryKey,
  getDockerOverviewQueryKey,
  getDockerProjectQueryOptions,
  getDockerProjectsQueryKey,
  getDockerProjectsQueryOptions,
  type DockerChange,
} from "#libs/api";

/** The reads of the Docker routes, which the apps' pages and the dashboard's Docker card share. */
export const dockerQueries = {
  /** Every installed app, by name. */
  projects: () => getDockerProjectsQueryOptions(),
  /** One installed app, its services and containers; a 404 for one that is not installed. */
  project: (project: string) => getDockerProjectQueryOptions(project),
  /**
   * The daemon's version, its containers, images and volumes, and the host's memory; read in the dashboard's region.
   * Built on orval's key and fetcher, as orval's options type their function as possibly `skipToken`, which a suspense
   * query refuses under `exactOptionalPropertyTypes`.
   */
  overview: () =>
    queryOptions({ queryKey: getDockerOverviewQueryKey(), queryFn: ({ signal }) => dockerOverview({ signal }) }),
};

/** Every read of the Docker routes, the compose batches included: the start of their keys. */
export const allDockerQueries: QueryKey = ["api", "docker"];

/** The reads each change of the daemon makes stale. */
export const staleAfterDockerChange: Readonly<Record<DockerChange, readonly QueryKey[]>> = {
  // The projects, each project's detail under them, and the compose batches, as one starts or ends.
  containers: [getDockerProjectsQueryKey(), getComposeBatchesQueryKey()],
  overview: [getDockerOverviewQueryKey()],
};
