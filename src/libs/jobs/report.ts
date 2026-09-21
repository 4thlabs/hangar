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

/**
 * The apps the last completed image check found behind their registry.
 *
 * Empty when no check has run yet, when it found nothing, or when the report could not be read:
 * the badge is an extra, never a reason for the Apps page to fail.
 *
 * Exported as the handle rather than only as functions, so a caller that composes it with another
 * snapshot — `src/app/snapshots.ts` — gets the same declaration the readers below use.
 */
export const outdatedSnapshot = snapshots.define("outdated", TTL, GRACE, read);

/** The last image check, if it has already been read. `undefined` means "ask properly". */
export function peekOutdatedProjects(): Set<string> | undefined {
  return outdatedSnapshot.peek()?.data;
}

/** {@link outdatedSnapshot}, awaited. */
export function outdatedProjects(): Promise<Set<string>> {
  return outdatedSnapshot.read();
}

async function read(): Promise<Set<string>> {
  try {
    // Jobs list by row id, descending — which is *not* run order: rerunning one from the Jobs
    // settings page resets the row it was run from and keeps its id, so a fresh result can sit
    // below an older one. Take the last few and pick by the timestamp the report itself carries.
    const runs = await Sidequest.job.list({ jobClass: "CheckImageVersion", state: "completed", limit: 10 });
    // JSON read back out of SQLite: trusted no further than the one shape we wrote.
    const reports = runs.map(run => run.result as ImageUpdateReport | undefined);
    const last = reports.reduce<ImageUpdateReport | undefined>(
      (newest, report) => (report?.checkedAt && (!newest || report.checkedAt > newest.checkedAt) ? report : newest),
      undefined,
    );
    const updates = Array.isArray(last?.updates) ? last.updates : [];

    return new Set(updates.filter(update => update.status === "outdated").map(update => update.project));
  } catch (error) {
    logger.error("Failed to read the last image check", { error });

    return new Set();
  }
}
