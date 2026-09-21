import { Sidequest } from "sidequest";
import { Snapshots } from "#libs/cache";
import type { ImageUpdateReport } from "#libs/docker";
import { logger } from "#libs/logs";

/**
 * The last report, cached so the pages that show the badge can read it without awaiting and so
 * render without a spinner. The check itself runs every four hours, so a minute of staleness is
 * free; the long grace only decides how long a jammed job queue keeps serving the last answer.
 */
const snapshots = new Snapshots();
const TTL = 60_000;
const GRACE = 3_600_000;

/** The last image check, if it has already been read. `undefined` means "ask properly". */
export function peekOutdatedProjects(): Set<string> | undefined {
  return snapshots.peek("outdated", TTL, GRACE, read)?.data;
}

/**
 * The apps the last completed image check found behind their registry.
 *
 * Empty when no check has run yet, when it found nothing, or when the report could not be read:
 * the badge is an extra, never a reason for the Apps page to fail.
 */
export function outdatedProjects(): Promise<Set<string>> {
  return snapshots.read("outdated", TTL, GRACE, read);
}

async function read(): Promise<Set<string>> {
  try {
    // Jobs list newest first, so one row is the last completed run.
    const [last] = await Sidequest.job.list({ jobClass: "CheckImageVersion", state: "completed", limit: 1 });
    // JSON read back out of SQLite: trusted no further than the one shape we wrote.
    const report = last?.result as ImageUpdateReport | undefined;
    const updates = Array.isArray(report?.updates) ? report.updates : [];

    return new Set(updates.filter(update => update.status === "outdated").map(update => update.project));
  } catch (error) {
    logger.error("Failed to read the last image check", { error });

    return new Set();
  }
}
