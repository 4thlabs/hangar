import { ApiError, type ErrorDetail } from "#libs/api";
import { commonMessages } from "#modules/common/messages.ts";

const words = commonMessages.errors;

/** A code of the server's errors, as `store.unknown_app`. */
type ErrorCode = ErrorDetail["code"];

/** The params of `Code`, as `{ app: string }`; nothing for a code that has none. */
type ParamsOf<Code extends ErrorCode> =
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

/** What the page says when the server could not be reached, or answered nothing it reads. */
export const serverUnreachable = words.serverUnreachable;

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
  "store.unknown_app": ({ app }) => words.store.unknownApp({ app }),
  "store.apps_unreadable": () => hinted(words.store.appsUnreadable),
  "store.install_failed": ({ app }) => hinted(words.store.installFailed({ app })),
  "store.uninstall_failed": ({ app }) => hinted(words.store.uninstallFailed({ app })),
  "store.clone_failed": () => hinted(words.store.cloneFailed),
  "store.pull_failed": () => hinted(words.store.pullFailed),
  "store.not_installed": () => words.store.notInstalled,
  "store.sync_running": () => words.store.syncRunning,
  "store.sync_crashed": () => hinted(words.store.syncCrashed),
  "config.syntax": ({ reason }) => ended(words.config.syntax({ reason })),
  "config.invalid": ({ field, reason }) => ended(words.config.invalid({ field, reason })),
  "config.unreadable": () => hinted(words.config.unreadable),
  "config.save_failed": () => hinted(words.config.saveFailed),
  "env.invalid_name": ({ name }) => words.env.invalidName({ name }),
  "env.line_break": ({ name }) => words.env.lineBreak({ name }),
  "env.unwritable_value": ({ name }) => words.env.unwritableValue({ name }),
  "env.unreadable": () => hinted(words.env.unreadable),
  "env.save_failed": () => hinted(words.env.saveFailed),
  "env.updated_and_removed": ({ name }) => words.env.updatedAndRemoved({ name }),
  "editor.app_exists": ({ app }) => words.editor.appExists({ app }),
  "editor.invalid_app_id": ({ app }) => words.editor.invalidAppId({ app }),
  "editor.invalid_path": ({ path }) => words.editor.invalidPath({ path }),
  "editor.through_file": ({ path }) => words.editor.throughFile({ path }),
  "editor.outside_app": ({ app, path }) => words.editor.outsideApp({ app, path }),
  "editor.hidden_file": ({ path }) => words.editor.hiddenFile({ path }),
  "editor.broken_symlink": ({ path }) => words.editor.brokenSymlink({ path }),
  "editor.no_such_file": ({ app, path }) => words.editor.noSuchFile({ app, path }),
  "editor.not_a_file": ({ path }) => words.editor.notAFile({ path }),
  "editor.too_large": ({ path, size }) => words.editor.tooLarge({ path, size }),
  "editor.binary": ({ path }) => words.editor.binary({ path }),
  "editor.not_utf8": ({ path }) => words.editor.notUtf8({ path }),
  "editor.file_exists": ({ path }) => words.editor.fileExists({ path }),
  "editor.file_appeared": ({ path }) => words.editor.fileAppeared({ path }),
  "editor.invalid_file": ({ path, reason }) => ended(words.editor.invalidFile({ path, reason })),
  "editor.compose_rejected": ({ path, complaint }) => words.editor.composeRejected({ path, complaint }),
  "editor.unchecked": ({ path }) => hinted(words.editor.unchecked({ path })),
  "editor.files_unreadable": ({ app }) => hinted(words.editor.filesUnreadable({ app })),
  "editor.read_failed": ({ path }) => hinted(words.editor.readFailed({ path })),
  "editor.save_failed": ({ path }) => hinted(words.editor.saveFailed({ path })),
  "editor.create_failed": ({ app }) => hinted(words.editor.createFailed({ app })),
  "docker.unavailable": () => hinted(words.docker.unavailable),
  "docker.unknown_project": ({ project }) => words.docker.unknownProject({ project }),
  "docker.invalid_project": ({ project }) => words.docker.invalidProject({ project }),
  "docker.unknown_container": ({ project, container }) => words.docker.unknownContainer({ project, container }),
  "compose.no_apps": () => words.compose.noApps,
  "store.batch_running": ({ apps }) => words.store.batchRunning({ apps }),
  "compose.app_busy": ({ app }) => words.compose.appBusy({ app }),
  "compose.unchecked": ({ command }) => hinted(words.compose.unchecked({ command })),
  "compose.failed": ({ app, command }) => hinted(words.compose.failed({ app, command })),
  "compose.unknown_batch": () => words.compose.unknownBatch,
  "jobs.unknown_run": () => words.jobs.unknownRun,
  "jobs.ended": () => words.jobs.ended,
  "jobs.crashed": () => hinted(words.jobs.crashed),
  "widgets.unknown_placement": () => words.widgets.unknownPlacement,
  "widgets.unavailable": () => hinted(words.widgets.unavailable),
  "widgets.unknown_image": () => words.widgets.unknownImage,
  "auth.invalid_credentials": () => words.auth.invalidCredentials,
  "auth.too_many_sign_ins": (_, retryAfter) => tooManySignIns(retryAfter),
  "auth.session_expired": () => words.auth.sessionExpired,
  "auth.user_removed": () => words.auth.userRemoved,
  "auth.credentials_changed": () => words.auth.credentialsChanged,
  "auth.unreadable_cookie": () => words.auth.unreadableCookie,
  "auth.no_oidc_provider": () => words.auth.noOidcProvider,
  "auth.cross_origin": ({ origin }) => words.auth.crossOrigin({ origin }),
};

/** The words of `error`, as a sentence: those of its code, the server's detail, or why the call got no answer. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return serverUnreachable;
  }

  if (error.detail) {
    return worded(error.detail, error.retryAfter);
  }

  const detail = error.problem?.detail;

  return detail === undefined ? serverUnreachable : sentence(detail);
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
    return words.auth.tooManySignIns;
  }

  const minutes = Math.max(1, Math.ceil(retryAfter / 60));

  return words.auth.tooManySignInsFor({ wait: minuteFormat.format(minutes) });
}

/** `message`, a sentence, followed by where its details are: the server's log. */
function hinted(message: string): string {
  return `${message} ${words.logHint}`;
}

/** `text` with a capital first letter and a final period, as a server's message is written neither. */
function sentence(text: string): string {
  return ended(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
}

/** `text` with a final period, unless it ends a sentence already, as a parser's reason may. */
function ended(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
