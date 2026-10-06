import type { Cache, CachePolicy } from "#libs/cache";
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
   * A new report only lands every four hours, so a minute of staleness is free; a jammed job queue
   * keeps serving the last answer for an hour.
   */
  private static readonly Policy: CachePolicy = { ttl: 60_000, maxStale: 3_600_000 };

  /** The cache key of the report. */
  private static readonly Key = "image-report:remotes";

  /** Where the completed runs are read from; injected so a test can hand over its own. */
  private readonly listRuns: ListRuns;

  /** Where the report is kept between reads. */
  private readonly cache: Cache;

  /**
   * @param listRuns Lists the completed image checks, `Sidequest.job.list` in production
   * @param cache Where the report is kept between reads
   */
  constructor(listRuns: ListRuns, cache: Cache) {
    this.listRuns = listRuns;
    this.cache = cache;
  }

  /** The registry digests of the last completed check, by reference; empty when there is none to read. */
  remotes(): Promise<RemoteDigests> {
    return this.cache.get(ImageCheckReport.Key, ImageCheckReport.Policy, () => this.read());
  }

  /**
   * Rereads the report, for whoever learns a check completed; readers keep the last one meanwhile, so
   * the Apps page does not fall back to its spinner. The job cannot call it: it runs in the worker process.
   * @returns Settles once the new report is read, and never rejects
   */
  refresh(): Promise<void> {
    return this.cache.refresh(ImageCheckReport.Key);
  }

  /** Reads the newest completed report. */
  private async read(): Promise<RemoteDigests> {
    try {
      // Row id is not run order (a rerun keeps its id), so pick by the report's own timestamp.
      const runs = await this.listRuns({ jobClass: "CheckImageVersion", state: "completed", limit: 10 });

      // JSON read back out of SQLite: trusted no further than the one shape we wrote.
      const reports = runs
        .map(run => run.result as ImageUpdateReport | undefined)
        .filter((report): report is ImageUpdateReport => Boolean(report?.checkedAt));

      // ISO timestamps, so the newest is also the greatest string.
      let last: ImageUpdateReport | undefined;

      for (const report of reports) {
        if (!last || report.checkedAt > last.checkedAt) {
          last = report;
        }
      }

      // A report from before digests were stored has `updates` instead: nothing to compare.
      return last?.remotes && typeof last.remotes === "object" ? last.remotes : {};
    } catch (error) {
      logger.error("Failed to read the last image check", { error });

      return {};
    }
  }
}
