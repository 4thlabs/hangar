import ky, { type KyInstance } from "ky";
import { Cache } from "#libs/cache";
import { env } from "#libs/env";
import { logger } from "#libs/logs";

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
 * Talks to the GitHub REST API, for the releases card.
 *
 * A GitHub release is published once and never moves, and the dashboard renders on every page
 * load: without a cache a handful of repositories exhausts the 60 requests/hour of an anonymous
 * client in minutes.
 *
 * ponytail: per-process cache, fine for the single container Hangar runs in.
 * Move the refresh into a sidequest job (like CheckImageVersion) if Hangar ever
 * runs more than one instance.
 */
export class GithubClient {
  /** How long a release is served before GitHub is asked again. */
  private static readonly Ttl = 30 * 60 * 1_000;

  /**
   * How long a release that GitHub has stopped answering for keeps being served.
   *
   * "A half-hour-old tag beats no tag at all" — but not forever: past this the card says it could
   * not load, rather than showing a tag nobody can tell is a year stale.
   */
  private static readonly Grace = 24 * 60 * 60 * 1_000;

  /** One entry per repository. The widget layer caches the loaded list; this caches each call. */
  private readonly cache = new Cache();

  /** The ky client, bound to the API and to the token when there is one. */
  private readonly http: KyInstance;

  /**
   * @param token A GitHub token: 60 requests/hour anonymous, 5000 with one
   */
  constructor(token?: string) {
    this.http = ky.extend({
      baseUrl: "https://api.github.com",
      retry: { limit: 1 },
      timeout: 10_000,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
    });
  }

  /**
   * The latest release of each repository, newest first.
   *
   * A repository that has no release, was renamed or is private drops out of the card, so one
   * bad entry in `hangar.yml` cannot take the whole card down; the log says which one and why.
   */
  async getLatestReleases(repositories: readonly string[]): Promise<GithubRelease[]> {
    const settled = await Promise.allSettled(repositories.map(repository => this.getLatestRelease(repository)));
    const releases: GithubRelease[] = [];

    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") releases.push(result.value);
      else
        logger.warn("Skipping a repository on the GitHub card", {
          error: result.reason,
          repository: repositories[index],
        });
    }

    return releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  /**
   * One repository's latest release, through the cache.
   */
  private getLatestRelease(repository: string): Promise<GithubRelease> {
    // A rate limit or a blip must not blank a card that already has an answer, which is what
    // `Grace` buys: a stale release is handed back at once and the retry goes out behind it.
    return this.cache.read(repository, GithubClient.Ttl, GithubClient.Grace, async () => {
      const latest = await this.http.get<LatestRelease>(`repos/${repository}/releases/latest`).json();

      return { repository, tag: latest.tag_name, url: latest.html_url, publishedAt: latest.published_at };
    });
  }
}

/** The client the dashboard shares, so every placement of the card reads one cache. */
export const githubClient = new GithubClient(env.GITHUB_TOKEN);
