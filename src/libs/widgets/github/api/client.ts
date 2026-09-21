import ky from "ky";
import { Snapshots } from "#libs/cache";
import { env } from "#libs/env";

/** The subset of a GitHub release displayed by Hangar. */
export interface GithubRelease {
  /** `owner/repo`, as declared in hangar.yml. */
  repository: string;
  /** The release tag, e.g. `v1.2.3`. */
  tag: string;
  /** Link to the release page. */
  url: string;
  /** ISO 8601, as GitHub returns it. */
  publishedAt: string;
}

/** The fields Hangar reads from `GET /repos/{owner}/{repo}/releases/latest`. */
interface LatestRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
}

/**
 * A GitHub release is published once and never moves, and the dashboard renders
 * on every page load: without a cache a handful of repositories exhausts the 60
 * requests/hour of an anonymous client in minutes.
 *
 * ponytail: per-process cache, fine for the single container Hangar runs in.
 * Move the refresh into a sidequest job (like CheckImageVersion) if Hangar ever
 * runs more than one instance.
 */
const TTL = 30 * 60 * 1_000;

/**
 * How long a release that GitHub has stopped answering for keeps being served.
 *
 * "A half-hour-old tag beats no tag at all" — but not forever: past this the card says it could
 * not load, rather than showing a tag nobody can tell is a year stale.
 */
const GRACE = 24 * 60 * 60 * 1_000;

/** One entry per repository. The widget layer caches the rendered card; this caches the calls. */
const snapshots = new Snapshots();

const client = ky.extend({
  baseUrl: "https://api.github.com",
  retry: { limit: 1 },
  timeout: 10_000,
  headers: {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // 60 requests/hour anonymous, 5000 with a token.
    ...(env.GITHUB_TOKEN === undefined ? {} : { Authorization: `Bearer ${env.GITHUB_TOKEN}` }),
  },
});

function fetchLatestRelease(repository: string): Promise<GithubRelease> {
  // A rate limit or a blip must not blank a card that already has an answer, which is what `GRACE`
  // buys: a stale release is handed back at once and the retry goes out behind it.
  return snapshots.read(repository, TTL, GRACE, async () => {
    const latest = await client.get<LatestRelease>(`repos/${repository}/releases/latest`).json();

    return { repository, tag: latest.tag_name, url: latest.html_url, publishedAt: latest.published_at };
  });
}

/**
 * The latest release of each repository, newest first.
 *
 * A repository that has no release, was renamed or is private simply drops out:
 * one bad entry in `hangar.yml` must not take the whole card down.
 */
export async function getLatestReleases(repositories: readonly string[]): Promise<GithubRelease[]> {
  const settled = await Promise.allSettled(repositories.map(repository => fetchLatestRelease(repository)));

  return settled
    .filter((result): result is PromiseFulfilledResult<GithubRelease> => result.status === "fulfilled")
    .map(result => result.value)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Drops every cached release. Tests only. */
export function clearReleaseCache() {
  snapshots.clear();
}
