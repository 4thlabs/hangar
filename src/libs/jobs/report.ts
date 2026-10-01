import { Sidequest } from "sidequest";
import { Cache, type Snapshot } from "#libs/cache";
import type { ImageUpdateReport, RemoteDigests } from "#libs/docker";
import { logger } from "#libs/logs";

/** The completed `CheckImageVersion` runs, as `Sidequest.job.list` answers them. */
export type ListRuns = (filter: {
  jobClass: string;
  state: "completed";
  limit: number;
}) => Promise<readonly { result?: unknown }[]>;

/**
 * What the registry served at the last completed image check, as the Apps badge and the
 * dashboard read it — through `Docker.outdated`, against what runs at the time of the read.
 */
export class ImageCheckReport {
  /**
   * How long the last report is reused. A new one only lands every four hours, so a minute of
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
   * The registry digests of the last completed check, by reference.
   *
   * Empty when no check has run yet, when the last one predates digests being stored, or when the
   * report could not be read: the badge is an extra, never a reason for the Apps page to fail.
   */
  readonly snapshot: Snapshot<RemoteDigests>;

  /**
   * @param listRuns Lists the completed image checks, `Sidequest.job.list` in production
   */
  constructor(listRuns: ListRuns) {
    this.listRuns = listRuns;
    this.snapshot = this.cache.define("remotes", ImageCheckReport.Ttl, ImageCheckReport.Grace, () => this.read());
  }

  /**
   * Drops the cached report, so the next read takes the newest one rather than serving the last
   * until its TTL. For whoever learns a check has completed — the job itself cannot call this: it
   * runs in the Sidequest worker, not in the process holding this cache.
   */
  invalidate() {
    this.cache.clear();
  }

  /**
   * Reads the newest completed report.
   */
  private async read(): Promise<RemoteDigests> {
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

      // A report from before digests were stored has `updates` instead: nothing to compare.
      return last?.remotes && typeof last.remotes === "object" ? last.remotes : {};
    } catch (error) {
      logger.error("Failed to read the last image check", { error });

      return {};
    }
  }
}

/** The report the web server reads, over Sidequest's own job table. */
export const imageCheckReport = new ImageCheckReport(filter => Sidequest.job.list(filter));
