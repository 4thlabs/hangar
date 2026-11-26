import { ApiError, type ErrorDetail } from "#libs/api";

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
export const serverUnreachable = "Could not reach the server. Try again.";

/** Where the page sends its reader for the rest of a failure of the server's own. */
const logHint = "See the server's log.";

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
  "store.unknown_app": ({ app }) => `The store has no app ${app}.`,
  "store.apps_unreadable": () => hinted("The store's apps could not be read."),
  "store.install_failed": ({ app }) => hinted(`The installation of ${app} failed.`),
  "store.uninstall_failed": ({ app }) => hinted(`The uninstallation of ${app} failed.`),
  "store.clone_failed": () => hinted("The store could not be cloned."),
  "store.pull_failed": () => hinted("The store could not be pulled."),
  "store.not_installed": () => "The store is not installed: install it from the settings first.",
  "store.sync_running": () => "The store is being synced: try again once its sync has ended.",
  "store.sync_crashed": () => hinted("The sync of the store stopped short."),
  "config.syntax": ({ reason }) => ended(`hangar.yml is not valid YAML: ${reason}`),
  "config.invalid": ({ field, reason }) => ended(`Invalid hangar.yml: ${field}: ${reason}`),
  "config.unreadable": () => hinted("hangar.yml could not be read."),
  "config.save_failed": () => hinted("hangar.yml could not be saved."),
  "env.invalid_name": ({ name }) => `Invalid variable name: ${name}.`,
  "env.line_break": ({ name }) => `The value of ${name} cannot contain a line break.`,
  "env.unwritable_value": ({ name }) => `The value of ${name} cannot be written to .env.global.`,
  "env.unreadable": () => hinted(".env.global could not be read."),
  "env.save_failed": () => hinted(".env.global could not be saved."),
  "env.updated_and_removed": ({ name }) => `${name} is both set and removed.`,
  "editor.app_exists": ({ app }) => `The app ${app} already exists.`,
  "editor.invalid_app_id": ({ app }) =>
    `${app} is not an app id: lowercase letters, digits, \`.\`, \`_\` and \`-\`, starting with a letter or a digit.`,
  "editor.invalid_path": ({ path }) => `Invalid file path: ${path}.`,
  "editor.through_file": ({ path }) => `${path} goes through a file, not a folder.`,
  "editor.outside_app": ({ app, path }) => `${path} leads outside the app ${app}.`,
  "editor.hidden_file": ({ path }) => `${path} leads to a hidden file.`,
  "editor.broken_symlink": ({ path }) => `${path} is a broken symlink.`,
  "editor.no_such_file": ({ app, path }) => `The app ${app} has no file ${path}.`,
  "editor.not_a_file": ({ path }) => `${path} is not a file.`,
  "editor.too_large": ({ path, size }) => `${path} is too large to edit here: ${size} bytes, 1 MiB at most.`,
  "editor.binary": ({ path }) => `${path} is not a text file.`,
  "editor.not_utf8": ({ path }) => `${path} is not UTF-8 text: saving it from the editor would corrupt it.`,
  "editor.file_exists": ({ path }) => `${path} already exists.`,
  "editor.file_appeared": ({ path }) => `${path} appeared while it was being saved: reopen it before saving again.`,
  "editor.invalid_file": ({ path, reason }) => ended(`${path} is not valid: ${reason}`),
  // Docker's complaint keeps its lines and its own punctuation: it is shown as Docker says it.
  "editor.compose_rejected": ({ path, complaint }) => `Docker rejects ${path}:\n${complaint}`,
  "editor.unchecked": ({ path }) => hinted(`Docker could not check ${path}.`),
  "editor.files_unreadable": ({ app }) => hinted(`The files of ${app} could not be listed.`),
  "editor.read_failed": ({ path }) => hinted(`${path} could not be read.`),
  "editor.save_failed": ({ path }) => hinted(`${path} could not be saved.`),
  "editor.create_failed": ({ app }) => hinted(`The app ${app} could not be created.`),
  "docker.unavailable": () => hinted("The Docker daemon could not be read."),
  "docker.unknown_project": ({ project }) => `No app ${project} is installed.`,
  "docker.invalid_project": ({ project }) =>
    `${project} is not a compose project name: lowercase letters, digits, \`_\` and \`-\`, starting with a letter or a digit.`,
  "docker.unknown_container": ({ project, container }) => `The app ${project} has no container ${container}.`,
  "compose.no_apps": () => "A compose command needs at least one app.",
  "store.batch_running": ({ apps }) =>
    `Compose commands run on ${apps.join(", ")}: sync the store once they have ended.`,
  "compose.app_busy": ({ app }) => `Another command runs on ${app}: try again once it has ended.`,
  "compose.unchecked": ({ command }) => hinted(`The batch of ${command} could not be checked.`),
  "compose.failed": ({ app, command }) => hinted(`${command} failed on ${app}.`),
  "compose.unknown_batch": () => "This compose command ended too long ago: its output is no longer kept.",
  "jobs.unknown_run": () => "This run of a job is no longer kept: read the jobs again.",
  "jobs.ended": () => "This run of a job has ended already.",
  "jobs.crashed": () => hinted("The job stopped short."),
  "widgets.unknown_placement": () => "This widget is no longer on the dashboard: reload the page.",
  "widgets.unavailable": () => hinted("Its service did not answer."),
  "widgets.unknown_image": () => "The widget has no such image.",
  "auth.invalid_credentials": () => "Invalid email or password.",
  "auth.too_many_sign_ins": (_, retryAfter) => tooManySignIns(retryAfter),
  "auth.session_expired": () => "Your session is no longer valid, or has expired: sign in again.",
  "auth.user_removed": () => "Your user is no longer in hangar.yml.",
  "auth.credentials_changed": () => "Your credentials have changed: sign in again.",
  "auth.unreadable_cookie": () => "The browser sent a cookie that is not text: sign in again.",
  "auth.no_oidc_provider": () => "No OpenID Connect provider is configured.",
  "auth.cross_origin": ({ origin }) => `The request comes from another origin than ${origin}.`,
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
    return "Too many failed sign-ins for this email: try again later.";
  }

  const minutes = Math.max(1, Math.ceil(retryAfter / 60));

  return `Too many failed sign-ins for this email: try again in ${minuteFormat.format(minutes)}.`;
}

/** `message`, a sentence, followed by where its details are. */
function hinted(message: string): string {
  return `${message} ${logHint}`;
}

/** `text` with a capital first letter and a final period, as a server's message is written neither. */
function sentence(text: string): string {
  return ended(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
}

/** `text` with a final period, unless it ends a sentence already, as a parser's reason may. */
function ended(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
