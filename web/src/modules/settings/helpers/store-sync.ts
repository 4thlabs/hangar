import type { StoreSync } from "#libs/api";
import { describeErrorDetail } from "#modules/common/helpers/error-message.ts";
import { commonMessages } from "#modules/common/messages.ts";
import { settingsMessages } from "#modules/settings/messages.ts";

// What the store's card says of its last sync.

/** How often a page reads the store again while a sync runs, in milliseconds. */
export const syncPollMs = 1000;

/** The time a sync ended at, in English. */
const syncTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** The sentence of `sync`: running, ended well, or failed with its reason. */
export function describeSync(sync: StoreSync): string {
  const words = settingsMessages.store.sync[sync.operation];

  if (sync.state === "running") {
    return words.running;
  }

  if (sync.state === "failed") {
    const reason = sync.error ? describeErrorDetail(sync.error) : commonMessages.errors.logHint;

    return words.failed({ reason });
  }

  return sync.finishedAt ? words.endedAt({ time: syncTimeFormat.format(new Date(sync.finishedAt)) }) : words.ended;
}

/** What the toast of a sync started says. */
export function syncStartedText(sync: StoreSync): string {
  return settingsMessages.store.sync[sync.operation].started;
}
