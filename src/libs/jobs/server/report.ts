import { Sidequest } from "sidequest";
import type { ImageUpdateReport } from "#libs/docker/compose.ts";
import { logger } from "#libs/logs";

/**
 * The apps the last completed image check found behind their registry.
 *
 * Empty when no check has run yet, when it found nothing, or when the report could not be read:
 * the badge is an extra, never a reason for the Apps page to fail.
 */
export async function outdatedProjects(): Promise<Set<string>> {
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
