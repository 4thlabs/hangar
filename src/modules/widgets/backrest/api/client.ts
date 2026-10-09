import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/**
 * An `int64` as Connect encodes it: a JSON string, never a number. Typed as what arrives (read as a number it yields
 * `NaN`) and converted once, in `BackrestRepo`.
 */
type Int64 = string;

/**
 * The backups a repository has run lately, as parallel arrays: index `0` of each is the last run. Absent before the
 * first backup: Connect omits default values.
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
 * Talks to one Backrest server over Connect-RPC: every call, reads included, is a `POST` at the root. No key: Backrest
 * has none, and the endpoint is unauthenticated on the container network.
 */
export class BackrestClient extends ServiceClient {
  static async connect(service: WidgetService) {
    return new BackrestClient(await ServiceClient.client(service, { prefix: "" }));
  }

  /** The per-repository and per-plan backup health Backrest's own dashboard shows. */
  getSummary() {
    return this.http.post<BackrestSummary>("v1.Backrest/GetSummaryDashboard", { json: {} }).json();
  }
}
