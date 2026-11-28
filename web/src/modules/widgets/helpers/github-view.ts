import type { GithubRelease } from "#libs/api";

/** The releases as the card lists them: newest first. */
export function githubView(releases: readonly GithubRelease[]): GithubRelease[] {
  // RFC 3339 in UTC, as GitHub writes its times, sorts as text.
  return releases.toSorted((first, second) => second.publishedAt.localeCompare(first.publishedAt));
}
