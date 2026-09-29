import { Sidequest } from "sidequest";
import { Cache, type Snapshot } from "#libs/cache";
import type { ImageUpdateReport } from "#libs/docker";
import { logger } from "#libs/logs";

/** The completed `CheckImageVersion` runs, as `Sidequest.job.list` answers them. */
export type ListRuns = (filter: {
  jobClass: string;
  state: "completed";
  limit: number;
}) => Promise<readonly { result?: unknown }[]>;

/**
 * What the last completed image check found, as the Apps badge and the dashboard read it.
 */
export class ImageCheckReport {
  /**
   * How long the last report is reused. The check itself runs every four hours, so a minute of
   * staleness is free.
   */
  private static readonly Ttl = 60_000;

  /** How long a jammed job queue keeps serving the last answer. */
  private static readonly Grace = 3_600_000;

  /**
   * The last report, cached so the pages that show the badge can read it without awaiting and so
   * render without a spinner.
   */
  private readonly cache = new Cache();

  /** Where the completed runs are read from; injected so a test can hand over its own. */
  private readonly listRuns: ListRuns;

  /**
   * When each app was last pulled to its newest image from this process.
   *
   * An update pulls by definition, so the app is current the moment it succeeds — and the last
   * report, which is up to four hours old, still says otherwise. Re-running the check to learn
   * what we already know would spend a registry round trip per reference, every click, against
   * the rate limit the four-hourly schedule exists to respect. So the answer is recorded here
   * and the report is read through it.
   *
   * ponytail: in memory, so a restart falls back to the last report and the badge is briefly
   * wrong again. Persist it only if that is ever noticed.
   */
  private readonly updatedAt = new Map<string, number>();

  /**
   * The apps the last completed image check found behind their registry.
   *
   * Empty when no check has run yet, when it found nothing, or when the report could not be read:
   * the badge is an extra, never a reason for the Apps page to fail.
   *
   * Public as the handle rather than only as {@link outdated}, so a caller that composes it with
   * another snapshot — `src/app/snapshots.ts` — gets the same declaration.
   */
  readonly snapshot: Snapshot<Set<string>>;

  /**
   * @param listRuns Lists the completed image checks, `Sidequest.job.list` in production
   */
  constructor(listRuns: ListRuns) {
    this.listRuns = listRuns;
    this.snapshot = this.cache.define("outdated", ImageCheckReport.Ttl, ImageCheckReport.Grace, () => this.read());
  }

  /**
   * {@link snapshot}, awaited.
   */
  outdated(): Promise<Set<string>> {
    return this.snapshot.read();
  }

  /**
   * Records that `project` now runs what its registry serves, and drops the cached set so the
   * badge goes at the next read rather than at the end of its TTL.
   */
  markUpdated(project: string) {
    this.updatedAt.set(project, Date.now());
    this.cache.clear();
  }

  /**
   * Reads the newest completed report, minus the apps updated since it was taken.
   */
  private async read(): Promise<Set<string>> {
    try {
      // Jobs list by row id, descending — which is *not* run order: rerunning one from the Jobs
      // settings page resets the row it was run from and keeps its id, so a fresh result can sit
      // below an older one. Take the last few and pick by the timestamp the report itself carries.
      const runs = await this.listRuns({ jobClass: "CheckImageVersion", state: "completed", limit: 10 });
      // JSON read back out of SQLite: trusted no further than the one shape we wrote.
      const reports = runs.map(run => run.result as ImageUpdateReport | undefined);
      const last = reports.reduce<ImageUpdateReport | undefined>(
        (newest, report) => (report?.checkedAt && (!newest || report.checkedAt > newest.checkedAt) ? report : newest),
        undefined,
      );
      const updates = Array.isArray(last?.updates) ? last.updates : [];
      const checkedAt = Date.parse(last?.checkedAt ?? "") || 0;

      // A check that ran after the update has the newer answer, whatever it is; the note has done
      // its job and would otherwise hide a genuine update found since.
      for (const [project, at] of this.updatedAt) if (at <= checkedAt) this.updatedAt.delete(project);

      return new Set(
        updates
          .filter(update => update.status === "outdated" && (this.updatedAt.get(update.project) ?? 0) <= checkedAt)
          .map(update => update.project),
      );
    } catch (error) {
      logger.error("Failed to read the last image check", { error });

      return new Set();
    }
  }
}

/** The report the web server reads, over Sidequest's own job table. */
export const imageCheckReport = new ImageCheckReport(filter => Sidequest.job.list(filter));
