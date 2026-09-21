import type { WidgetService } from "../../config/config.ts";
import { serviceClient } from "../../shared/service-client.ts";

/**
 * An `int64`, as Connect encodes it: a JSON string, never a number.
 *
 * Every count, size and timestamp Backrest reports is one of these. Reading them as numbers type-
 * checks against a hand-written interface and then silently yields `NaN`, so they are typed as what
 * actually arrives and converted once, in `displayRepo`.
 */
type Int64 = string;

/**
 * The backups a repository has run lately, newest first.
 *
 * Parallel arrays rather than a list of records — index `0` of each is the last run. Absent for a
 * repository that has never backed up: Connect omits a default value rather than sending it.
 */
export interface BackrestRecentBackups {
  status?: string[];
  timestampMs?: Int64[];
  bytesAdded?: Int64[];
}

/** One repository's health, as `GetSummaryDashboard` reports it. */
export interface BackrestRepoSummary {
  id: string;
  backupsSuccessLast30days?: Int64;
  backupsFailed30days?: Int64;
  bytesAddedLast30days?: Int64;
  protectedBytes?: Int64;
  nextBackupTimeMs?: Int64;
  recentBackups?: BackrestRecentBackups;
}

/** What the dashboard endpoint answers. Hangar reads the repositories; the plans are per-schedule. */
export interface BackrestSummary {
  repoSummaries?: BackrestRepoSummary[];
}

/**
 * Talks to one Backrest server.
 *
 * Backrest is Connect-RPC, not REST: every call is a `POST` with a JSON body, reads included — a
 * `GET` answers 404 — and the methods sit at the root rather than under `/api`, hence `prefix: ""`.
 *
 * It takes no key: Backrest has no API-key concept, and on the container network the endpoint is
 * unauthenticated. `serviceClient` sends no header when there is no key, so nothing is needed here.
 */
export async function createBackrestClient(service: WidgetService) {
  const client = await serviceClient(service, { prefix: "" });

  return {
    /** Gets the per-repository and per-plan backup health the Backrest dashboard itself shows. */
    getSummary: () => client.post<BackrestSummary>("v1.Backrest/GetSummaryDashboard", { json: {} }).json(),
  };
}
