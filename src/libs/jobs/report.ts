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
  /** A new report only lands every four hours, so a minute of staleness is free. */
  private static readonly Ttl = 60_000;

  /** How long a jammed job queue keeps serving the last answer. */
  private static readonly Grace = 3_600_000;

  private readonly cache = new Cache();

  /** Where the completed runs are read from; injected so a test can hand over its own. */
  private readonly listRuns: ListRuns;

  /** The registry digests of the last completed check, by reference; empty when there is none to read. */
  readonly snapshot: Snapshot<RemoteDigests>;

  /**
   * @param listRuns Lists the completed image checks, `Sidequest.job.list` in production
   */
  constructor(listRuns: ListRuns) {
    this.listRuns = listRuns;
    this.snapshot = this.cache.define("remotes", ImageCheckReport.Ttl, ImageCheckReport.Grace, () => this.read());
  }

  /**
   * Drops the cached report, for whoever learns a check completed. The job cannot call it: it runs in
   * the worker process.
   */
  invalidate() {
    this.cache.clear();
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

/** The report the web server reads, over Sidequest's own job table. */
export const imageCheckReport = new ImageCheckReport(filter => Sidequest.job.list(filter));
