import type { StoreSync } from "#libs/api";
import { describeErrorDetail } from "#modules/common/error-message.ts";

// What the store's card says of its last sync.

/** How often a page reads the store again while a sync runs, in milliseconds. */
export const syncPollMs = 1000;

/** The time a sync ended at, in English. */
const syncTimeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** The sentence of `sync`: running, ended well, or failed with its reason. */
export function describeSync(sync: StoreSync): string {
  const noun = sync.operation === "install" ? "installation" : "update";

  if (sync.state === "running") {
    return sync.operation === "install" ? "Installing the store…" : "Updating the store…";
  }

  if (sync.state === "failed") {
    const reason = sync.error ? describeErrorDetail(sync.error) : "See the server's log.";

    return `The ${noun} of the store failed: ${reason}`;
  }

  const ended = sync.finishedAt ? ` on ${syncTimeFormat.format(new Date(sync.finishedAt))}` : "";
  const verb = sync.operation === "install" ? "installed" : "updated";

  return `The store was ${verb}${ended}.`;
}

/** What the toast of a sync started says. */
export function syncStarted(sync: StoreSync): string {
  return sync.operation === "install"
    ? "The installation of the store was started."
    : "The update of the store was started.";
}
