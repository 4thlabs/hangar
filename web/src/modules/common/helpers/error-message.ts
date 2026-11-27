import { ApiError, type ErrorDetail } from "#libs/api";
import { m } from "#paraglide/messages.js";

/** A code of the server's errors, as `store.unknown_app`. */
export type ErrorCode = ErrorDetail["code"];

/** The params of `Code`, as `{ app: string }`; nothing for a code that has none. */
export type ParamsOf<Code extends ErrorCode> =
  Extract<ErrorDetail, { code: Code }> extends { params: infer Params } ? Params : undefined;

/** The words of each code, from its params, and the seconds its answer's `Retry-After` says to wait, if any. */
type Words = { [Code in ErrorCode]: (params: ParamsOf<Code>, retryAfter: number | undefined) => string };

/** The codes that have params. */
type CodeWithParams = { [Code in ErrorCode]: ParamsOf<Code> extends undefined ? never : Code }[ErrorCode];

/** The names of `Names` in any order, each once: a list of them that leaves one out is a type error. */
type EveryName<Names, All = Names> = [Names] extends [never]
  ? []
  : Names extends Names
    ? [Names, ...EveryName<Exclude<All, Names>>]
    : never;

/** The names of the params of each code that has some, which its words need. */
type ParamNames = { [Code in CodeWithParams]: EveryName<keyof ParamsOf<Code>> };

// What the page says of an error of the server's. Each has a stable code and its params beside the server's English
// message: this is the one place that keys the words by the code, which a catalog will word in another language. A
// problem carries them as its `type` and its members, which `ApiError.detail` reads; a body that holds an error, as the
// sync's, carries them whole, an `ErrorDetail`. A code this page does not know, from a server newer than it, or one
// without a param its words need, from another version or a member quoll left out, is said in the server's own message.

/** A list of names, comma-separated: `alpha, beta, gamma`. */
const commas = new Intl.ListFormat("en", { type: "unit", style: "short" });

/** A wait in whole minutes, in English: `15 minutes`. */
const minuteFormat = new Intl.NumberFormat("en", { style: "unit", unit: "minute", unitDisplay: "long" });

/** The params each code's words need. */
const paramNames: ParamNames = {
  "store.unknown_app": ["app"],
  "store.install_failed": ["app"],
  "store.uninstall_failed": ["app"],
  "config.syntax": ["reason"],
  "config.invalid": ["field", "reason"],
  "env.invalid_name": ["name"],
  "env.line_break": ["name"],
  "env.unwritable_value": ["name"],
  "env.updated_and_removed": ["name"],
  "editor.app_exists": ["app"],
  "editor.invalid_app_id": ["app"],
  "editor.invalid_path": ["path"],
  "editor.through_file": ["path"],
  "editor.outside_app": ["app", "path"],
  "editor.hidden_file": ["path"],
  "editor.broken_symlink": ["path"],
  "editor.no_such_file": ["app", "path"],
  "editor.not_a_file": ["path"],
  "editor.too_large": ["path", "size"],
  "editor.binary": ["path"],
  "editor.not_utf8": ["path"],
  "editor.file_exists": ["path"],
  "editor.file_appeared": ["path"],
  "editor.invalid_file": ["path", "reason"],
  "editor.compose_rejected": ["path", "complaint"],
  "editor.unchecked": ["path"],
  "editor.files_unreadable": ["app"],
  "editor.read_failed": ["path"],
  "editor.save_failed": ["path"],
  "editor.create_failed": ["app"],
  "docker.unknown_project": ["project"],
  "docker.invalid_project": ["project"],
  "docker.unknown_container": ["project", "container"],
  "store.batch_running": ["apps"],
  "compose.app_busy": ["app"],
  "compose.unchecked": ["command"],
  "compose.failed": ["app", "command"],
  "compose.unknown_batch": ["batch"],
  "jobs.unknown_run": ["run"],
  "jobs.ended": ["run"],
  "widgets.unknown_placement": ["key"],
  "widgets.unavailable": ["widget"],
  "widgets.unknown_image": ["key", "image"],
  "auth.cross_origin": ["origin"],
};

/** The words of each code. */
const wordsByCode: Words = {
  "store.unknown_app": ({ app }) => m.common_store_unknown_app({ app }),
  "store.apps_unreadable": () => hinted(m.common_store_apps_unreadable()),
  "store.install_failed": ({ app }) => hinted(m.common_store_install_failed({ app })),
  "store.uninstall_failed": ({ app }) => hinted(m.common_store_uninstall_failed({ app })),
  "store.clone_failed": () => hinted(m.common_store_clone_failed()),
  "store.pull_failed": () => hinted(m.common_store_pull_failed()),
  "store.not_installed": () => m.common_store_not_installed(),
  "store.sync_running": () => m.common_store_sync_running(),
  "store.sync_crashed": () => hinted(m.common_store_sync_crashed()),
  "config.syntax": ({ reason }) => ended(m.common_config_syntax({ reason })),
  "config.invalid": ({ field, reason }) => ended(m.common_config_invalid({ field, reason })),
  "config.unreadable": () => hinted(m.common_config_unreadable()),
  "config.save_failed": () => hinted(m.common_config_save_failed()),
  "env.invalid_name": ({ name }) => m.common_env_invalid_name({ name }),
  "env.line_break": ({ name }) => m.common_env_line_break({ name }),
  "env.unwritable_value": ({ name }) => m.common_env_unwritable_value({ name }),
  "env.unreadable": () => hinted(m.common_env_unreadable()),
  "env.save_failed": () => hinted(m.common_env_save_failed()),
  "env.updated_and_removed": ({ name }) => m.common_env_updated_and_removed({ name }),
  "editor.app_exists": ({ app }) => m.common_editor_app_exists({ app }),
  "editor.invalid_app_id": ({ app }) => m.common_editor_invalid_app_id({ app }),
  "editor.invalid_path": ({ path }) => m.common_editor_invalid_path({ path }),
  "editor.through_file": ({ path }) => m.common_editor_through_file({ path }),
  "editor.outside_app": ({ app, path }) => m.common_editor_outside_app({ app, path }),
  "editor.hidden_file": ({ path }) => m.common_editor_hidden_file({ path }),
  "editor.broken_symlink": ({ path }) => m.common_editor_broken_symlink({ path }),
  "editor.no_such_file": ({ app, path }) => m.common_editor_no_such_file({ app, path }),
  "editor.not_a_file": ({ path }) => m.common_editor_not_a_file({ path }),
  "editor.too_large": ({ path, size }) => m.common_editor_too_large({ path, size }),
  "editor.binary": ({ path }) => m.common_editor_binary({ path }),
  "editor.not_utf8": ({ path }) => m.common_editor_not_utf8({ path }),
  "editor.file_exists": ({ path }) => m.common_editor_file_exists({ path }),
  "editor.file_appeared": ({ path }) => m.common_editor_file_appeared({ path }),
  "editor.invalid_file": ({ path, reason }) => ended(m.common_editor_invalid_file({ path, reason })),
  "editor.compose_rejected": ({ path, complaint }) => m.common_editor_compose_rejected({ path, complaint }),
  "editor.unchecked": ({ path }) => hinted(m.common_editor_unchecked({ path })),
  "editor.files_unreadable": ({ app }) => hinted(m.common_editor_files_unreadable({ app })),
  "editor.read_failed": ({ path }) => hinted(m.common_editor_read_failed({ path })),
  "editor.save_failed": ({ path }) => hinted(m.common_editor_save_failed({ path })),
  "editor.create_failed": ({ app }) => hinted(m.common_editor_create_failed({ app })),
  "docker.unavailable": () => hinted(m.common_docker_unavailable()),
  "docker.unknown_project": ({ project }) => m.common_docker_unknown_project({ project }),
  "docker.invalid_project": ({ project }) => m.common_docker_invalid_project({ project }),
  "docker.unknown_container": ({ project, container }) => m.common_docker_unknown_container({ project, container }),
  "compose.no_apps": () => m.common_compose_no_apps(),
  "store.batch_running": ({ apps }) => m.common_store_batch_running({ apps: commas.format(apps) }),
  "compose.app_busy": ({ app }) => m.common_compose_app_busy({ app }),
  "compose.unchecked": ({ command }) => hinted(m.common_compose_unchecked({ command })),
  "compose.failed": ({ app, command }) => hinted(m.common_compose_failed({ app, command })),
  "compose.unknown_batch": () => m.common_compose_unknown_batch(),
  "jobs.unknown_run": () => m.common_jobs_unknown_run(),
  "jobs.ended": () => m.common_jobs_ended(),
  "jobs.crashed": () => hinted(m.common_jobs_crashed()),
  "widgets.unknown_placement": () => m.common_widgets_unknown_placement(),
  "widgets.unavailable": () => hinted(m.common_widgets_unavailable()),
  "widgets.unknown_image": () => m.common_widgets_unknown_image(),
  "auth.invalid_credentials": () => m.common_auth_invalid_credentials(),
  "auth.too_many_sign_ins": (_, retryAfter) => tooManySignIns(retryAfter),
  "auth.session_expired": () => m.common_auth_session_expired(),
  "auth.user_removed": () => m.common_auth_user_removed(),
  "auth.credentials_changed": () => m.common_auth_credentials_changed(),
  "auth.unreadable_cookie": () => m.common_auth_unreadable_cookie(),
  "auth.no_oidc_provider": () => m.common_auth_no_oidc_provider(),
  "auth.cross_origin": ({ origin }) => m.common_auth_cross_origin({ origin }),
};

/** The words of `error`, as a sentence: those of its code, the server's detail, or why the call got no answer. */
export function describeError(error: unknown): string {
  // The server could not be reached, or answered nothing the page reads.
  if (!(error instanceof ApiError)) {
    return m.common_errors_server_unreachable();
  }

  if (error.detail) {
    return worded(error.detail, error.retryAfter);
  }

  const detail = error.problem?.detail;

  return detail === undefined ? m.common_errors_server_unreachable() : sentence(detail);
}

/** The words of `detail`, an error a body carries, as a sentence. */
export function describeErrorDetail(detail: ErrorDetail): string {
  return worded(detail, undefined);
}

/** The words of the code of `detail`, or its message for a code this page does not know or whose params it lacks. */
function worded(detail: ErrorDetail, retryAfter: number | undefined): string {
  const params: Record<string, unknown> | undefined = "params" in detail ? detail.params : undefined;
  const isKnown = Object.hasOwn(wordsByCode, detail.code);

  if (!isKnown || !hasParams(detail.code, params)) {
    return sentence(detail.message);
  }

  const words = wordsByCode[detail.code] as (params: unknown, retryAfter: number | undefined) => string;

  return words(params, retryAfter);
}

/** Whether `params` holds each param the words of `code` need. */
function hasParams(code: ErrorCode, params: Record<string, unknown> | undefined): boolean {
  const names: readonly string[] = Object.hasOwn(paramNames, code) ? paramNames[code as CodeWithParams] : [];

  return names.every(name => params?.[name] !== undefined && params[name] !== null);
}

/** What a 429 of the sign-in says: the wait its `Retry-After` gives, in minutes. */
function tooManySignIns(retryAfter: number | undefined): string {
  if (retryAfter === undefined) {
    return m.common_auth_too_many_sign_ins();
  }

  const minutes = Math.max(1, Math.ceil(retryAfter / 60));

  return m.common_auth_too_many_sign_ins_for({ wait: minuteFormat.format(minutes) });
}

/** `message`, a sentence, followed by where its details are: the server's log. */
function hinted(message: string): string {
  return `${message} ${m.common_errors_log_hint()}`;
}

/** `text` with a capital first letter and a final period, as a server's message is written neither. */
function sentence(text: string): string {
  return ended(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
}

/** `text` with a final period, unless it ends a sentence already, as a parser's reason may. */
function ended(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
