import { m } from "#paraglide/messages.js";

/**
 * An app id, as the core checks it (`AppId::regex()` in `crates/core/src/store/app_id.rs`): a folder name under
 * `store/`, lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a digit. The contract carries no
 * pattern (decided with the maintainer on 2026-11-27, #205): the two change together.
 */
const appId = /^[a-z0-9][a-z0-9._-]*$/;

/** Why `id` cannot be a new app's id, or `undefined` when it can. */
export function appIdError(id: string): string | undefined {
  return appId.test(id) ? undefined : m.store_new_app_invalid_id({ id });
}
