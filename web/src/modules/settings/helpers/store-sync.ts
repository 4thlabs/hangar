import type { StoreSync } from "#libs/api";
import { describeErrorDetail } from "#modules/common/helpers/error-message.ts";
import { settingsLabels } from "#modules/settings/helpers/settings-labels.ts";
import { m } from "#paraglide/messages.js";

// What the store's card says of its last sync.

/** How often a page reads the store again while a sync runs, in milliseconds. */
export const syncPollMs = 1000;

/** The time a sync ended at, in English. */
const syncTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/**
 * The words of the operation of `sync`; those of an update for an operation this page does not know, from a newer
 * server, as the server only installs the store once.
 */
function syncLabels(sync: StoreSync) {
  const known = Object.hasOwn(settingsLabels.sync, sync.operation);

  return settingsLabels.sync[known ? sync.operation : "update"];
}

/** The sentence of `sync`: running, ended well, or failed with its reason. */
export function describeSync(sync: StoreSync): string {
  const labels = syncLabels(sync);

  if (sync.state === "running") {
    return labels.running();
  }

  if (sync.state === "failed") {
    const reason = sync.error ? describeErrorDetail(sync.error) : m.common_errors_log_hint();

    return labels.failed({ reason });
  }

  return sync.finishedAt ? labels.endedAt({ time: syncTimeFormat.format(new Date(sync.finishedAt)) }) : labels.ended();
}

/** What the toast of a sync started says. */
export function syncStartedText(sync: StoreSync): string {
  return syncLabels(sync).started();
}
