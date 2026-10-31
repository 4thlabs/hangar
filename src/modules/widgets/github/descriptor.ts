import * as z from "zod";
import { columnSchema, describeWidget, ttlField, WidgetIcon } from "../config/config.ts";
import { GithubMessages } from "./messages.ts";

/** `owner/repo` — the only form the GitHub releases API takes. */
const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/repo");

/** Reads the public GitHub API, not a store app: no service to declare. */
export const githubReleasesDescriptor = describeWidget({
  schema: z.object({
    type: z.literal("github-releases"),
    column: columnSchema,
    ...ttlField,
    repositories: z.array(repositorySchema).min(1),
  }),
  appearance: {
    messages: GithubMessages,
    icon: WidgetIcon.dashboard("github", "github-light"),
  },
  module: () => import("./releases.tsx"),
  create: ({ githubReleases }, config) => githubReleases(config.repositories),
});
