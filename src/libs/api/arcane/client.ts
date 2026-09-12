import { createServiceClient } from "#libs/api/shared";
import { env } from "#libs/env";
import type { ArcaneResult, Dashboard, Project, Tag } from "./type.ts";

const { url, client: apiClient } = createServiceClient({
  service: "arcane",
  apiKey: env.ARCANE_API_KEY,
});

export const arcaneUrl = url;
export { apiClient };

/** Gets the aggregated dashboard for an environment. */
export const getDashboard = async (environment: number = 0) => {
  return await apiClient.get<ArcaneResult<Dashboard>>(`/environments/${environment}/dashboard`).json();
};

/**
 * Gets the tags for a specific environment
 * @param environment
 * @returns
 */
export const getTags = async (environment: number = 0) => {
  return await apiClient.get<ArcaneResult<Tag[]>>(`/environments/${environment}/projects/tags`).json();
};

/**
 * Gets all the projects for an environment.
 * @param environment The requested environment, default to 0
 */
export const getProjects = async (environment: number = 0, limit: number = 100) => {
  return await apiClient.get<ArcaneResult<Project[]>>(`/environments/${environment}/projects?limit=${limit}`).json();
};

/**
 * Gets a project for an environment
 * @param id
 * @param environment
 * @returns
 */
export const getProject = async (id: string, environment: number = 0) => {
  return await apiClient.get<ArcaneResult<Project>>(`/environments/${environment}/projects/${id}`).json();
};

/**
 * Updates a tag on a specific project
 * @param id
 * @param name
 * @param color
 * @param attached
 * @param environment
 */
export const updateProjectTag = async (
  id: string,
  name: string,
  color: string = "",
  attached: boolean,
  environment: number = 0,
) => {
  return await apiClient
    .patch<ArcaneResult<Project>>(`/environments/${environment}/projects/${id}/tags`, {
      json: {
        name: name,
        color: color,
        attached: attached,
      },
    })
    .json();
};
