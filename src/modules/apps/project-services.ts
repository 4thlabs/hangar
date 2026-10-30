import type { ComposeProjectDetail } from "#libs/docker";

/**
 * What Docker tells about an app's services, for a page that stays up whatever the daemon answers: `absent` when
 * the app has no container (not installed, never started, or taken down), `unavailable` when the daemon could not be
 * read.
 */
export type ProjectServices =
  { state: "loaded"; detail: ComposeProjectDetail } | { state: "absent" } | { state: "unavailable" };
