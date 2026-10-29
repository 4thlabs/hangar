import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/** The subset of a Forgejo repository Hangar reads. */
export interface ForgejoRepository {
  full_name: string;
  html_url: string;
  /** ISO 8601, bumped by every push and settings change. */
  updated_at: string;
  archived: boolean;
  /** A repository with no commit yet, which has nothing to run. */
  empty: boolean;
  /** Whether the Actions unit is enabled; a repository without it answers 404 for its runs. */
  has_actions: boolean;
}

/** What a Forgejo Actions run reports as its state, finished or not. */
export type ForgejoRunStatus =
  "unknown" | "waiting" | "running" | "success" | "failure" | "cancelled" | "skipped" | "blocked";

/** The subset of a Forgejo Actions run Hangar displays. */
export interface ForgejoRun {
  id: number;
  /** The commit or pull request title the run was triggered for. */
  title: string;
  status: ForgejoRunStatus;
  /** The workflow file, e.g. `ci.yml`. */
  workflow_id: string;
  /** The branch, tag or pull request (`#2`) the run is on. */
  prettyref: string;
  html_url: string;
  /** ISO 8601. `started` and `stopped` are Go's zero time (`0001-01-01…`) until they happen. */
  created: string;
  started: string;
  stopped: string;
  repository: Pick<ForgejoRepository, "full_name">;
}

/** Talks to one Forgejo instance. The key goes in `Authorization: token …`. */
export class ForgejoClient extends ServiceClient {
  /** Forgejo's default maximum page size, and so the most active runs a repository is asked for. */
  private static readonly PageSize = 50;

  /** The statuses of a run not finished yet: running, or waiting for a runner or an approval. */
  static readonly ActiveStatuses: readonly ForgejoRunStatus[] = ["running", "waiting", "blocked"];

  static async connect(service: WidgetService) {
    const token = async () => {
      const key = await service.apiKey();

      return key === undefined ? undefined : `token ${key}`;
    };

    return new ForgejoClient(
      await ServiceClient.client(
        { api: service.api, apiKey: token },
        { prefix: "/api/v1", apiKeyHeader: "Authorization" },
      ),
    );
  }

  /** Every repository visible to the key (only public ones without), whoever owns it. */
  getRepositories(): Promise<ForgejoRepository[]> {
    return ForgejoClient.everyPage(page =>
      this.http
        .get<{ data: ForgejoRepository[] }>("repos/search", { searchParams: { limit: ForgejoClient.PageSize, page } })
        .json()
        .then(({ data }) => data),
    );
  }

  /** Every repository of one user or organization that the key can see. */
  getOwnerRepositories(owner: string): Promise<ForgejoRepository[]> {
    return ForgejoClient.everyPage(page =>
      this.http
        .get<ForgejoRepository[]>(`users/${owner}/repos`, { searchParams: { limit: ForgejoClient.PageSize, page } })
        .json(),
    );
  }

  /** A repository's runs that have not finished, newest first. */
  async getActiveRuns(repository: string): Promise<ForgejoRun[]> {
    const status = ForgejoClient.ActiveStatuses.map(active => ["status", active]);

    const { workflow_runs } = await this.http
      .get<{ workflow_runs: ForgejoRun[] }>(`repos/${repository}/actions/runs`, {
        // Forgejo ignores `limit` unless `page` is given too.
        searchParams: [...status, ["limit", String(ForgejoClient.PageSize)], ["page", "1"]],
      })
      .json();

    return workflow_runs;
  }

  /** Every page of a listing, from the first until a short one. */
  private static async everyPage(getPage: (page: number) => Promise<ForgejoRepository[]>) {
    const repositories: ForgejoRepository[] = [];

    for (let page = 1; ; page++) {
      const items = await getPage(page);

      repositories.push(...items);

      // A short page is the last one; `X-Total-Count` would say the same, but a proxy may strip it.
      if (items.length < ForgejoClient.PageSize) {
        return repositories;
      }
    }
  }
}
