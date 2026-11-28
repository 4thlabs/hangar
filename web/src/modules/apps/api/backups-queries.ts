import type { QueryClient } from "@tanstack/react-query";
import {
  getBackupsBackUpMutationOptions,
  getBackupsDownloadUrl,
  getBackupsRemoveMutationOptions,
  getBackupsStatusQueryKey,
  getBackupsStatusQueryOptions,
} from "#libs/api";
import { backupsPollDelay } from "#modules/apps/helpers/backup-status.ts";

/** The reads of an app's backups. */
export const backupsQueries = {
  /**
   * The backups of `app`: its plan, its archives and the run of its backup that waits or runs, read again every two
   * seconds while one does, so that its archive shows once it ends.
   */
  status: (app: string) =>
    getBackupsStatusQueryOptions(app, { query: { refetchInterval: query => backupsPollDelay(query.state.data) } }),
};

/** The changes of an app's backups. */
export const backupsMutations = {
  /** Asks for a backup now; the backups are read again whatever the outcome, as one refused waits or runs already. */
  backUp: () =>
    getBackupsBackUpMutationOptions({
      mutation: { onSettled: (_data, _error, { app }, _onMutateResult, { client }) => readBackupsAgain(client, app) },
    }),
  /** Removes an archive; the backups are read again whatever the outcome, as one not there is gone already. */
  remove: () =>
    getBackupsRemoveMutationOptions({
      mutation: { onSettled: (_data, _error, { app }, _onMutateResult, { client }) => readBackupsAgain(client, app) },
    }),
};

/** Where the archive `archive` of `app` is downloaded from, as `<app>-<archive>.zip`. */
export function backupArchiveUrl(app: string, archive: string): string {
  return getBackupsDownloadUrl(app, archive);
}

/** Reads the backups of `app` again. */
function readBackupsAgain(client: QueryClient, app: string): Promise<void> {
  return client.invalidateQueries({ queryKey: getBackupsStatusQueryKey(app) });
}
