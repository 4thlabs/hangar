//! The errors the page may show, each a stable code with its params beside its English message, so that a catalog can
//! word them in another language later without the server changing.
//!
//! A problem carries the code as its `type`, `/problems/store.unknown_app`, its params as extension members, and the
//! English message as its detail. A body that holds an error, as the sync of the store's, carries it whole, an
//! [`ErrorDetail`].

#[cfg(feature = "client")]
mod client;

use std::fmt;

use http::StatusCode;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// An error the page may show: its code, as `store.unknown_app`, and its params, as `{ "app": "alpha" }`. The server
/// answers it with its [`status`](Self::status), as a problem whose `type` is [`problem_type`](Self::problem_type),
/// whose extension members are the params, and whose detail is its English [`message`](Self::message):
///
/// ```json
/// {
///   "type": "/problems/store.unknown_app",
///   "title": "Not Found",
///   "status": 404,
///   "detail": "the store has no app alpha",
///   "app": "alpha"
/// }
/// ```
///
/// A param is named as RFC 9457 names an extension member, a letter, then letters, digits or `_`, three characters
/// at least, and none of `type`, `title`, `status`, `detail` and `instance`, which quoll would leave out.
///
/// ```
/// use hangar_api::ErrorCode;
///
/// let error = ErrorCode::UnknownApp { app: "alpha".to_owned() };
///
/// assert_eq!(error.code(), "store.unknown_app");
/// assert_eq!(error.message(), "the store has no app alpha");
/// assert_eq!(
///     serde_json::to_value(&error).expect("JSON"),
///     serde_json::json!({ "code": "store.unknown_app", "params": { "app": "alpha" } })
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "code", content = "params")]
#[non_exhaustive]
pub enum ErrorCode {
    /// The store carries no app of this id.
    #[serde(rename = "store.unknown_app")]
    UnknownApp {
        /// The id asked for.
        app: String,
    },

    /// The store's apps could not be listed.
    #[serde(rename = "store.apps_unreadable")]
    AppsUnreadable,

    /// An app could not be installed.
    #[serde(rename = "store.install_failed")]
    InstallFailed {
        /// The app's display name.
        app: String,
    },

    /// An app could not be uninstalled: `docker compose down` failed, or its link could not be removed.
    #[serde(rename = "store.uninstall_failed")]
    UninstallFailed {
        /// The app's display name.
        app: String,
    },

    /// The store's clone failed.
    #[serde(rename = "store.clone_failed")]
    CloneFailed,

    /// The store's pull failed: git could not reach it, or a change of the clone, to `hangar.yml` say, is in the way.
    #[serde(rename = "store.pull_failed")]
    PullFailed,

    /// The store is not cloned yet, which this needs.
    #[serde(rename = "store.not_installed")]
    StoreNotInstalled,

    /// `hangar.yml` is not YAML, holds no document, or several.
    #[serde(rename = "config.syntax")]
    ConfigSyntax {
        /// What the YAML parser says, in English.
        reason: String,
    },

    /// `hangar.yml` does not follow its rules.
    #[serde(rename = "config.invalid")]
    ConfigInvalid {
        /// The path of the field at fault, as `categories[0].color`; `.` for the whole file.
        field: String,
        /// What is wrong with it, in English.
        reason: String,
    },

    /// `hangar.yml` could not be read.
    #[serde(rename = "config.unreadable")]
    ConfigUnreadable,

    /// `hangar.yml` could not be written.
    #[serde(rename = "config.save_failed")]
    ConfigSaveFailed,

    /// A name compose does not take as a variable's.
    #[serde(rename = "env.invalid_name")]
    InvalidVariableName {
        /// The name.
        name: String,
    },

    /// A value with a line break, which would add a variable to the file.
    #[serde(rename = "env.line_break")]
    LineBreak {
        /// The variable.
        name: String,
    },

    /// A value that no quoting writes so that it reads back the same.
    #[serde(rename = "env.unwritable_value")]
    UnwritableValue {
        /// The variable.
        name: String,
    },

    /// `.env.global` could not be read.
    #[serde(rename = "env.unreadable")]
    EnvUnreadable,

    /// `.env.global` could not be copied aside or written.
    #[serde(rename = "env.save_failed")]
    EnvSaveFailed,

    /// A save that both sets and removes a variable.
    #[serde(rename = "env.updated_and_removed")]
    UpdatedAndRemoved {
        /// The variable.
        name: String,
    },

    /// A sync of the store runs, which a change of the store waits for the end of.
    #[serde(rename = "store.sync_running")]
    SyncRunning,

    /// The sync of the store stopped short: the server failed it, and its log says how.
    #[serde(rename = "store.sync_crashed")]
    SyncCrashed,

    /// An app to create whose id the store has already: its folder, or anything in its place.
    #[serde(rename = "editor.app_exists")]
    AppExists {
        /// The id.
        app: String,
    },

    /// An id that cannot name an app.
    #[serde(rename = "editor.invalid_app_id")]
    InvalidAppId {
        /// The id asked for.
        app: String,
    },

    /// A path of an app's file that is not one: empty, absolute, with an empty segment or one that starts with a dot, as `..` or a hidden file.
    #[serde(rename = "editor.invalid_path")]
    InvalidPath {
        /// The path, as it was given.
        path: String,
    },

    /// A path of an app's file that goes through a file as if it were a folder.
    #[serde(rename = "editor.through_file")]
    ThroughFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A path of an app's file that leads out of its folder, through a symlink.
    #[serde(rename = "editor.outside_app")]
    OutsideApp {
        /// The app.
        app: String,
        /// The path in the app's folder.
        path: String,
    },

    /// A path of an app's file that leads, through a symlink, to a hidden entry of its folder.
    #[serde(rename = "editor.hidden_file")]
    HiddenFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A path of an app's file through a symlink to nothing, which a write would create wherever it points.
    #[serde(rename = "editor.broken_symlink")]
    BrokenSymlink {
        /// The path in the app's folder, up to the symlink.
        path: String,
    },

    /// An app has no file at this path.
    #[serde(rename = "editor.no_such_file")]
    NoSuchFile {
        /// The app.
        app: String,
        /// The path in the app's folder.
        path: String,
    },

    /// Something that is not a regular file sits at this path, as a folder.
    #[serde(rename = "editor.not_a_file")]
    NotAFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A file too large for the editor, which sends it whole: over 1 MiB.
    #[serde(rename = "editor.too_large")]
    TooLarge {
        /// The path in the app's folder.
        path: String,
        /// Its size, in bytes.
        size: u64,
    },

    /// A binary file, which the editor does not open.
    #[serde(rename = "editor.binary")]
    BinaryFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A file that is not UTF-8, which a save from the editor would corrupt.
    #[serde(rename = "editor.not_utf8")]
    NotUtf8Text {
        /// The path in the app's folder.
        path: String,
    },

    /// A file to create where something is already, a hidden file included.
    #[serde(rename = "editor.file_exists")]
    FileExists {
        /// The path in the app's folder.
        path: String,
    },

    /// A file found missing as it was saved, which something else created first: it is left as it is.
    #[serde(rename = "editor.file_appeared")]
    FileAppeared {
        /// The path in the app's folder.
        path: String,
    },

    /// A YAML or `.env` file that does not parse, which is not written.
    #[serde(rename = "editor.invalid_file")]
    InvalidFile {
        /// The path in the app's folder.
        path: String,
        /// What the parser says, in English.
        reason: String,
    },

    /// Docker rejects a compose file, by `docker compose config` or `docker stack config`: it is not written. The complaint is about the operator's own file, and is the only way to say what to fix in it.
    #[serde(rename = "editor.compose_rejected")]
    ComposeRejected {
        /// The path in the app's folder.
        path: String,
        /// Docker's complaint, its last lines, the app's files named by their paths in its folder and the credentials of a URL taken out.
        complaint: String,
    },

    /// Docker could not check a compose file, as when it did not start: it is not written.
    #[serde(rename = "editor.unchecked")]
    FileUnchecked {
        /// The path in the app's folder.
        path: String,
    },

    /// An app's files could not be listed.
    #[serde(rename = "editor.files_unreadable")]
    FilesUnreadable {
        /// The app.
        app: String,
    },

    /// A file of an app could not be read.
    #[serde(rename = "editor.read_failed")]
    FileReadFailed {
        /// The path in the app's folder.
        path: String,
    },

    /// A file of an app could not be created or written.
    #[serde(rename = "editor.save_failed")]
    FileSaveFailed {
        /// The path in the app's folder.
        path: String,
    },

    /// An app could not be created.
    #[serde(rename = "editor.create_failed")]
    AppCreateFailed {
        /// The id.
        app: String,
    },

    /// The Docker daemon could not be reached, or answered with an error.
    #[serde(rename = "docker.unavailable")]
    DockerUnavailable,

    /// No installed app of this name.
    #[serde(rename = "docker.unknown_project")]
    UnknownProject {
        /// The name asked for.
        project: String,
    },

    /// A name `docker compose -p` does not take as a project: lowercase letters, digits, `_` and `-`, starting with a
    /// letter or a digit.
    #[serde(rename = "docker.invalid_project")]
    InvalidProject {
        /// The name asked for.
        project: String,
    },
    /// No container of the app has this id.
    #[serde(rename = "docker.unknown_container")]
    UnknownContainer {
        /// The app.
        project: String,
        /// The id asked for.
        container: String,
    },

    /// A batch of compose commands asked for no app.
    #[serde(rename = "compose.no_apps")]
    NoApps,
    /// A sync of the store, while compose batches run on the files it pulls and links.
    #[serde(rename = "store.batch_running")]
    BatchRunning {
        /// The apps the batches hold, by id.
        apps: Vec<String>,
    },
    /// An app that another command holds: a batch of compose commands that runs on it, or its install or uninstall.
    #[serde(rename = "compose.app_busy")]
    AppBusy {
        /// The app.
        app: String,
    },
    /// A batch of compose commands that the server could not check before it ran: its log says why.
    #[serde(rename = "compose.unchecked")]
    BatchUnchecked {
        /// The command line, as `docker compose up -d`.
        command: String,
    },
    /// A compose command failed on an app: its output says why, and the server's log.
    #[serde(rename = "compose.failed")]
    ComposeFailed {
        /// The app.
        app: String,
        /// The command line, as `docker compose up -d`.
        command: String,
    },
    /// No batch of compose commands of this id runs, or ended a short while ago.
    #[serde(rename = "compose.unknown_batch")]
    UnknownBatch {
        /// The id asked for.
        batch: u64,
    },
    /// No run of a job of this id is kept.
    #[serde(rename = "jobs.unknown_run")]
    UnknownJobRun {
        /// The id asked for.
        run: u64,
    },
    /// A run of a job to cancel that has ended already.
    #[serde(rename = "jobs.ended")]
    JobEnded {
        /// The run's id.
        run: u64,
    },
    /// A run of a job stopped short: the server failed it, and its log says how.
    #[serde(rename = "jobs.crashed")]
    JobCrashed,
    /// No widget that loads is placed under this key: none at all, the clock, or Docker's stats, which the page reads
    /// itself.
    #[serde(rename = "widgets.unknown_placement")]
    UnknownPlacement {
        /// The key asked for.
        key: String,
    },
    /// The service of a widget did not answer, or not as the widget reads it: the server's log says why.
    #[serde(rename = "widgets.unavailable")]
    WidgetUnavailable {
        /// The widget's `type`, as `frigate-events`.
        widget: String,
    },
    /// A widget has no such image to relay: it relays none, its service has none of this id, or the id is not one its
    /// service would give.
    #[serde(rename = "widgets.unknown_image")]
    UnknownImage {
        /// The placement's key.
        key: String,
        /// The image's id asked for.
        image: String,
    },
    /// A sign-in by password of an email unknown to `hangar.yml`, or with a wrong password.
    #[serde(rename = "auth.invalid_credentials")]
    InvalidCredentials,

    /// Too many sign-ins by password failed for this email: the answer's `Retry-After` says when it is taken again.
    #[serde(rename = "auth.too_many_sign_ins")]
    TooManySignIns,

    /// A session cookie that is not one the server signed, or one that has expired.
    #[serde(rename = "auth.session_expired")]
    SessionExpired,

    /// The user of a session that `hangar.yml` no longer lists.
    #[serde(rename = "auth.user_removed")]
    UserRemoved,

    /// The user of a session whose password or provider's subject changed in `hangar.yml` since they signed in.
    #[serde(rename = "auth.credentials_changed")]
    CredentialsChanged,

    /// A `Cookie` header that is not text.
    #[serde(rename = "auth.unreadable_cookie")]
    UnreadableCookie,

    /// A sign-in through an OpenID Connect provider, which the server has none of.
    #[serde(rename = "auth.no_oidc_provider")]
    NoOidcProvider,

    /// A request that changes something, from a page of another origin than the server's.
    #[serde(rename = "auth.cross_origin")]
    CrossOrigin {
        /// The server's origin, `HANGAR_URL`'s.
        origin: String,
    },
}

/// An error as a body carries it, as a store sync's: its code, its params, and its English message, which the page
/// shows for a code it does not know.
///
/// ```
/// use hangar_api::{ErrorCode, ErrorDetail};
///
/// let detail = ErrorDetail::from(ErrorCode::UnknownApp { app: "alpha".to_owned() });
///
/// assert_eq!(
///     serde_json::to_value(&detail).expect("JSON"),
///     serde_json::json!({
///         "code": "store.unknown_app",
///         "params": { "app": "alpha" },
///         "message": "the store has no app alpha",
///     })
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ErrorDetail {
    /// The code and its params.
    #[serde(flatten)]
    pub code: ErrorCode,
    /// The code's English message.
    pub message: String,
}

impl From<ErrorCode> for ErrorDetail {
    fn from(code: ErrorCode) -> Self {
        Self {
            message: code.message(),
            code,
        }
    }
}

impl ErrorCode {
    /// What the `type` of a problem of the server's holds before its code.
    pub const PROBLEM_TYPE_PREFIX: &str = "/problems/";

    /// Where the page sends its reader for the rest of a failure of the server's own.
    const LOG_HINT: &str = "See the server's log.";

    /// The `type` of its problem, a URI relative to the server: `/problems/store.unknown_app`.
    pub fn problem_type(&self) -> String {
        format!("{}{}", Self::PROBLEM_TYPE_PREFIX, self.code())
    }

    /// Its params by their names, as `{ "app": "alpha" }`; none for a code that has none.
    pub fn params(&self) -> Map<String, Value> {
        let written = serde_json::to_value(self)
            .expect("a code holds strings, numbers and lists of strings, which JSON writes");

        match written {
            Value::Object(mut fields) => match fields.remove("params") {
                Some(Value::Object(params)) => params,
                _ => Map::new(),
            },
            _ => Map::new(),
        }
    }

    /// The code, as `store.unknown_app`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownApp { .. } => "store.unknown_app",
            Self::AppsUnreadable => "store.apps_unreadable",
            Self::InstallFailed { .. } => "store.install_failed",
            Self::UninstallFailed { .. } => "store.uninstall_failed",
            Self::CloneFailed => "store.clone_failed",
            Self::PullFailed => "store.pull_failed",
            Self::StoreNotInstalled => "store.not_installed",
            Self::ConfigSyntax { .. } => "config.syntax",
            Self::ConfigInvalid { .. } => "config.invalid",
            Self::ConfigUnreadable => "config.unreadable",
            Self::ConfigSaveFailed => "config.save_failed",
            Self::InvalidVariableName { .. } => "env.invalid_name",
            Self::LineBreak { .. } => "env.line_break",
            Self::UnwritableValue { .. } => "env.unwritable_value",
            Self::EnvUnreadable => "env.unreadable",
            Self::EnvSaveFailed => "env.save_failed",
            Self::UpdatedAndRemoved { .. } => "env.updated_and_removed",
            Self::SyncRunning => "store.sync_running",
            Self::SyncCrashed => "store.sync_crashed",
            Self::AppExists { .. } => "editor.app_exists",
            Self::InvalidAppId { .. } => "editor.invalid_app_id",
            Self::InvalidPath { .. } => "editor.invalid_path",
            Self::ThroughFile { .. } => "editor.through_file",
            Self::OutsideApp { .. } => "editor.outside_app",
            Self::BrokenSymlink { .. } => "editor.broken_symlink",
            Self::HiddenFile { .. } => "editor.hidden_file",
            Self::NoSuchFile { .. } => "editor.no_such_file",
            Self::NotAFile { .. } => "editor.not_a_file",
            Self::TooLarge { .. } => "editor.too_large",
            Self::BinaryFile { .. } => "editor.binary",
            Self::NotUtf8Text { .. } => "editor.not_utf8",
            Self::FileExists { .. } => "editor.file_exists",
            Self::FileAppeared { .. } => "editor.file_appeared",
            Self::InvalidFile { .. } => "editor.invalid_file",
            Self::ComposeRejected { .. } => "editor.compose_rejected",
            Self::FileUnchecked { .. } => "editor.unchecked",
            Self::FilesUnreadable { .. } => "editor.files_unreadable",
            Self::FileReadFailed { .. } => "editor.read_failed",
            Self::FileSaveFailed { .. } => "editor.save_failed",
            Self::AppCreateFailed { .. } => "editor.create_failed",
            Self::DockerUnavailable => "docker.unavailable",
            Self::UnknownProject { .. } => "docker.unknown_project",
            Self::InvalidProject { .. } => "docker.invalid_project",
            Self::UnknownContainer { .. } => "docker.unknown_container",
            Self::NoApps => "compose.no_apps",
            Self::BatchRunning { .. } => "store.batch_running",
            Self::AppBusy { .. } => "compose.app_busy",
            Self::BatchUnchecked { .. } => "compose.unchecked",
            Self::ComposeFailed { .. } => "compose.failed",
            Self::UnknownBatch { .. } => "compose.unknown_batch",
            Self::UnknownJobRun { .. } => "jobs.unknown_run",
            Self::JobEnded { .. } => "jobs.ended",
            Self::JobCrashed => "jobs.crashed",
            Self::UnknownPlacement { .. } => "widgets.unknown_placement",
            Self::WidgetUnavailable { .. } => "widgets.unavailable",
            Self::UnknownImage { .. } => "widgets.unknown_image",
            Self::InvalidCredentials => "auth.invalid_credentials",
            Self::TooManySignIns => "auth.too_many_sign_ins",
            Self::SessionExpired => "auth.session_expired",
            Self::UserRemoved => "auth.user_removed",
            Self::CredentialsChanged => "auth.credentials_changed",
            Self::UnreadableCookie => "auth.unreadable_cookie",
            Self::NoOidcProvider => "auth.no_oidc_provider",
            Self::CrossOrigin { .. } => "auth.cross_origin",
        }
    }

    /// The status the server answers it with.
    pub fn status(&self) -> StatusCode {
        match self {
            Self::UnknownApp { .. }
            | Self::NoSuchFile { .. }
            | Self::UnknownProject { .. }
            | Self::UnknownContainer { .. }
            | Self::UnknownBatch { .. }
            | Self::UnknownJobRun { .. }
            | Self::UnknownPlacement { .. }
            | Self::UnknownImage { .. }
            | Self::NoOidcProvider => StatusCode::NOT_FOUND,
            Self::WidgetUnavailable { .. } => StatusCode::BAD_GATEWAY,
            Self::InvalidCredentials
            | Self::SessionExpired
            | Self::UserRemoved
            | Self::CredentialsChanged
            | Self::UnreadableCookie => StatusCode::UNAUTHORIZED,
            Self::CrossOrigin { .. } => StatusCode::FORBIDDEN,
            Self::TooManySignIns => StatusCode::TOO_MANY_REQUESTS,
            Self::DockerUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::StoreNotInstalled
            | Self::SyncRunning
            | Self::AppExists { .. }
            | Self::FileExists { .. }
            | Self::FileAppeared { .. }
            | Self::AppBusy { .. }
            | Self::BatchRunning { .. }
            | Self::JobEnded { .. } => StatusCode::CONFLICT,
            Self::ConfigSyntax { .. }
            | Self::ConfigInvalid { .. }
            | Self::InvalidVariableName { .. }
            | Self::LineBreak { .. }
            | Self::UnwritableValue { .. }
            | Self::UpdatedAndRemoved { .. }
            | Self::InvalidAppId { .. }
            | Self::InvalidPath { .. }
            | Self::ThroughFile { .. }
            | Self::OutsideApp { .. }
            | Self::BrokenSymlink { .. }
            | Self::HiddenFile { .. }
            | Self::NotAFile { .. }
            | Self::TooLarge { .. }
            | Self::BinaryFile { .. }
            | Self::NotUtf8Text { .. }
            | Self::InvalidFile { .. }
            | Self::ComposeRejected { .. }
            | Self::InvalidProject { .. }
            | Self::NoApps => StatusCode::BAD_REQUEST,
            Self::AppsUnreadable
            | Self::InstallFailed { .. }
            | Self::UninstallFailed { .. }
            | Self::CloneFailed
            | Self::PullFailed
            | Self::ConfigUnreadable
            | Self::ConfigSaveFailed
            | Self::EnvUnreadable
            | Self::EnvSaveFailed
            | Self::SyncCrashed
            | Self::FileUnchecked { .. }
            | Self::FilesUnreadable { .. }
            | Self::FileReadFailed { .. }
            | Self::FileSaveFailed { .. }
            | Self::AppCreateFailed { .. }
            | Self::ComposeFailed { .. }
            | Self::BatchUnchecked { .. }
            | Self::JobCrashed => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// The message in English, the detail of its problem, which the page shows for a code it does not know: a failure
    /// of the server's own sends its reader to the log, where its cause is.
    pub fn message(&self) -> String {
        match self {
            Self::UnknownApp { app } => format!("the store has no app {app}"),
            Self::AppsUnreadable => Self::hinted("the store's apps could not be read"),
            Self::InstallFailed { app } => {
                Self::hinted(&format!("the installation of {app} failed"))
            }
            Self::UninstallFailed { app } => {
                Self::hinted(&format!("the uninstallation of {app} failed"))
            }
            Self::CloneFailed => Self::hinted("the store could not be cloned"),
            Self::PullFailed => Self::hinted("the store could not be pulled"),
            Self::StoreNotInstalled => {
                "the store is not installed: install it from the settings first".to_owned()
            }
            Self::ConfigSyntax { reason } => format!("hangar.yml is not valid YAML: {reason}"),
            Self::ConfigInvalid { field, reason } => {
                format!("invalid hangar.yml: {field}: {reason}")
            }
            Self::ConfigUnreadable => Self::hinted("hangar.yml could not be read"),
            Self::ConfigSaveFailed => Self::hinted("hangar.yml could not be saved"),
            Self::InvalidVariableName { name } => format!("invalid variable name: {name}"),
            Self::LineBreak { name } => format!("the value of {name} cannot contain a line break"),
            Self::UnwritableValue { name } => {
                format!("the value of {name} cannot be written to .env.global")
            }
            Self::EnvUnreadable => Self::hinted(".env.global could not be read"),
            Self::EnvSaveFailed => Self::hinted(".env.global could not be saved"),
            Self::UpdatedAndRemoved { name } => format!("{name} is both set and removed"),
            Self::SyncRunning => {
                "the store is being synced: try again once its sync has ended".to_owned()
            }
            Self::SyncCrashed => Self::hinted("the sync of the store stopped short"),
            Self::AppExists { app } => format!("the app {app} already exists"),
            Self::InvalidAppId { app } => format!(
                "{app} is not an app id: lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a digit"
            ),
            Self::InvalidPath { path } => format!("invalid file path: {path}"),
            Self::ThroughFile { path } => format!("{path} goes through a file, not a folder"),
            Self::OutsideApp { app, path } => format!("{path} leads outside the app {app}"),
            Self::BrokenSymlink { path } => format!("{path} is a broken symlink"),
            Self::HiddenFile { path } => format!("{path} leads to a hidden file"),
            Self::NoSuchFile { app, path } => format!("the app {app} has no file {path}"),
            Self::NotAFile { path } => format!("{path} is not a file"),
            Self::TooLarge { path, size } => {
                format!("{path} is too large to edit here: {size} bytes, 1 MiB at most")
            }
            Self::BinaryFile { path } => format!("{path} is not a text file"),
            Self::NotUtf8Text { path } => {
                format!("{path} is not UTF-8 text: saving it from the editor would corrupt it")
            }
            Self::FileExists { path } => format!("{path} already exists"),
            Self::FileAppeared { path } => {
                format!("{path} appeared while it was being saved: reopen it before saving again")
            }
            Self::InvalidFile { path, reason } => format!("{path} is not valid: {reason}"),
            Self::ComposeRejected { path, complaint } => {
                format!("docker rejects {path}:\n{complaint}")
            }
            Self::FileUnchecked { path } => Self::hinted(&format!("docker could not check {path}")),
            Self::FilesUnreadable { app } => {
                Self::hinted(&format!("the files of {app} could not be listed"))
            }
            Self::FileReadFailed { path } => Self::hinted(&format!("{path} could not be read")),
            Self::FileSaveFailed { path } => Self::hinted(&format!("{path} could not be saved")),
            Self::AppCreateFailed { app } => {
                Self::hinted(&format!("the app {app} could not be created"))
            }
            Self::DockerUnavailable => Self::hinted("the Docker daemon could not be read"),
            Self::UnknownProject { project } => format!("no app {project} is installed"),
            Self::InvalidProject { project } => format!(
                "{project} is not a compose project name: lowercase letters, digits, `_` and `-`, starting with a letter or a digit"
            ),
            Self::NoApps => "a compose command needs at least one app".to_owned(),
            Self::BatchRunning { apps } => format!(
                "compose commands run on {}: sync the store once they have ended",
                apps.join(", ")
            ),
            Self::AppBusy { app } => {
                format!("another command runs on {app}: try again once it has ended")
            }
            Self::BatchUnchecked { command } => {
                Self::hinted(&format!("the batch of {command} could not be checked"))
            }
            Self::ComposeFailed { app, command } => {
                Self::hinted(&format!("{command} failed on {app}"))
            }
            Self::UnknownBatch { batch } => format!("no compose batch {batch} is kept"),
            Self::UnknownJobRun { run } => format!("no run {run} of a job is kept"),
            Self::JobEnded { run } => format!("the run {run} of a job has ended already"),
            Self::JobCrashed => Self::hinted("the job stopped short"),
            Self::UnknownPlacement { key } => format!("no widget that loads is placed as {key}"),
            Self::WidgetUnavailable { widget } => {
                Self::hinted(&format!("the {widget} widget could not be loaded"))
            }
            Self::UnknownImage { key, image } => format!("the widget {key} has no image {image}"),
            Self::UnknownContainer { project, container } => {
                format!("the app {project} has no container {container}")
            }
            Self::InvalidCredentials => "invalid email or password".to_owned(),
            Self::TooManySignIns => {
                "too many failed sign-ins for this email: try again later".to_owned()
            }
            Self::SessionExpired => {
                "the session is not valid or has expired: sign in again".to_owned()
            }
            Self::UserRemoved => "the session's user is no longer in hangar.yml".to_owned(),
            Self::CredentialsChanged => {
                "the user's credentials have changed: sign in again".to_owned()
            }
            Self::UnreadableCookie => "the Cookie header is not text".to_owned(),
            Self::NoOidcProvider => "no OpenID Connect provider is configured".to_owned(),
            Self::CrossOrigin { origin } => {
                format!("the request comes from another origin than {origin}")
            }
        }
    }

    /// `message`, a sentence, followed by where its details are.
    fn hinted(message: &str) -> String {
        format!("{message}. {}", Self::LOG_HINT)
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message())
    }
}

impl From<ErrorCode> for quoll::Error {
    /// The problem of `code`: its status, its `type`, its params as extension members, and its English message as the
    /// detail.
    fn from(code: ErrorCode) -> Self {
        let problem = Self::new(code.status(), code.message()).with_type(code.problem_type());

        code.params()
            .into_iter()
            .fold(problem, |problem, (name, value)| {
                problem.with_member(name, value)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::ErrorCode;

    /// One of each code, so that a test sees them all.
    pub(super) fn every_code() -> Vec<ErrorCode> {
        let app = || "alpha".to_owned();
        let name = || "ALPHA_KEY".to_owned();

        vec![
            ErrorCode::UnknownApp { app: app() },
            ErrorCode::AppsUnreadable,
            ErrorCode::InstallFailed { app: app() },
            ErrorCode::UninstallFailed { app: app() },
            ErrorCode::CloneFailed,
            ErrorCode::PullFailed,
            ErrorCode::StoreNotInstalled,
            ErrorCode::ConfigSyntax {
                reason: "a tab".to_owned(),
            },
            ErrorCode::ConfigInvalid {
                field: "categories".to_owned(),
                reason: "required".to_owned(),
            },
            ErrorCode::ConfigUnreadable,
            ErrorCode::ConfigSaveFailed,
            ErrorCode::InvalidVariableName { name: name() },
            ErrorCode::LineBreak { name: name() },
            ErrorCode::UnwritableValue { name: name() },
            ErrorCode::EnvUnreadable,
            ErrorCode::EnvSaveFailed,
            ErrorCode::UpdatedAndRemoved { name: name() },
            ErrorCode::SyncRunning,
            ErrorCode::SyncCrashed,
            ErrorCode::AppExists { app: app() },
            ErrorCode::InvalidAppId { app: app() },
            ErrorCode::InvalidPath {
                path: "path".to_owned(),
            },
            ErrorCode::ThroughFile {
                path: "path".to_owned(),
            },
            ErrorCode::OutsideApp {
                app: app(),
                path: "path".to_owned(),
            },
            ErrorCode::HiddenFile {
                path: "path".to_owned(),
            },
            ErrorCode::BrokenSymlink {
                path: "path".to_owned(),
            },
            ErrorCode::NoSuchFile {
                app: app(),
                path: "path".to_owned(),
            },
            ErrorCode::NotAFile {
                path: "path".to_owned(),
            },
            ErrorCode::TooLarge {
                path: "path".to_owned(),
                size: 1_048_577,
            },
            ErrorCode::BinaryFile {
                path: "path".to_owned(),
            },
            ErrorCode::NotUtf8Text {
                path: "path".to_owned(),
            },
            ErrorCode::FileExists {
                path: "path".to_owned(),
            },
            ErrorCode::FileAppeared {
                path: "path".to_owned(),
            },
            ErrorCode::InvalidFile {
                path: "path".to_owned(),
                reason: "reason".to_owned(),
            },
            ErrorCode::ComposeRejected {
                path: "path".to_owned(),
                complaint: "complaint".to_owned(),
            },
            ErrorCode::FileUnchecked {
                path: "path".to_owned(),
            },
            ErrorCode::FilesUnreadable { app: app() },
            ErrorCode::FileReadFailed {
                path: "path".to_owned(),
            },
            ErrorCode::FileSaveFailed {
                path: "path".to_owned(),
            },
            ErrorCode::AppCreateFailed { app: app() },
            ErrorCode::DockerUnavailable,
            ErrorCode::UnknownProject { project: app() },
            ErrorCode::InvalidProject {
                project: "llama.cpp".to_owned(),
            },
            ErrorCode::NoApps,
            ErrorCode::BatchRunning {
                apps: vec![app(), "gamma".to_owned()],
            },
            ErrorCode::AppBusy { app: app() },
            ErrorCode::BatchUnchecked {
                command: "docker compose up -d".to_owned(),
            },
            ErrorCode::ComposeFailed {
                app: app(),
                command: "docker compose up -d".to_owned(),
            },
            ErrorCode::UnknownBatch { batch: 7 },
            ErrorCode::UnknownJobRun { run: 7 },
            ErrorCode::JobEnded { run: 7 },
            ErrorCode::JobCrashed,
            ErrorCode::UnknownPlacement {
                key: "frigate-events-1x2y3z".to_owned(),
            },
            ErrorCode::WidgetUnavailable {
                widget: "frigate-events".to_owned(),
            },
            ErrorCode::UnknownImage {
                key: "frigate-events-1x2y3z".to_owned(),
                image: "1700000000.0-person".to_owned(),
            },
            ErrorCode::UnknownContainer {
                project: app(),
                container: "0123456789ab".to_owned(),
            },
            ErrorCode::InvalidCredentials,
            ErrorCode::TooManySignIns,
            ErrorCode::SessionExpired,
            ErrorCode::UserRemoved,
            ErrorCode::CredentialsChanged,
            ErrorCode::UnreadableCookie,
            ErrorCode::NoOidcProvider,
            ErrorCode::CrossOrigin {
                origin: "https://hangar.example.com".to_owned(),
            },
        ]
    }

    #[test]
    fn writes_each_code_as_it_names_itself_and_reads_it_back() {
        for code in every_code() {
            let json = serde_json::to_value(&code).expect("JSON");

            assert_eq!(json["code"], code.code(), "{code:?}");
            assert_eq!(
                serde_json::from_value::<ErrorCode>(json).expect("read back"),
                code
            );
        }
    }

    #[test]
    fn writes_a_detail_as_its_code_its_params_and_its_message_and_reads_it_back() {
        for code in every_code() {
            let detail = super::ErrorDetail::from(code.clone());
            let json = serde_json::to_value(&detail).expect("JSON");

            assert_eq!(json["code"], code.code(), "{code:?}");
            assert_eq!(json["message"], code.message(), "{code:?}");
            assert_eq!(
                serde_json::from_value::<super::ErrorDetail>(json).expect("read back"),
                detail
            );
        }
    }

    #[test]
    fn keeps_its_params_apart_from_its_message() {
        let code = ErrorCode::ConfigInvalid {
            field: "categories[0].color".to_owned(),
            reason: "required".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(&code).expect("JSON")["params"],
            serde_json::json!({ "field": "categories[0].color", "reason": "required" })
        );
        assert_eq!(
            code.message(),
            "invalid hangar.yml: categories[0].color: required"
        );
    }

    #[test]
    fn answers_each_code_as_a_problem_of_its_type_with_each_param_a_member() {
        for code in every_code() {
            let answered = quoll::Error::from(code.clone()).into_answered();
            let body = answered.body().expect("a problem");
            let problem: serde_json::Value = serde_json::from_slice(body).expect("JSON");
            let mut expected = serde_json::json!({
                "type": format!("/problems/{}", code.code()),
                "title": code.status().canonical_reason(),
                "status": code.status().as_u16(),
                "detail": code.message(),
            });

            expected
                .as_object_mut()
                .expect("an object")
                .extend(code.params());

            assert_eq!(problem, expected, "{code:?}");
        }
    }

    #[test]
    fn answers_a_failure_of_the_server_s_own_with_a_500_that_points_to_the_log() {
        let error = quoll::Error::from(ErrorCode::InstallFailed {
            app: "Alpha".to_owned(),
        });

        assert_eq!(
            error.status(),
            Some(http::StatusCode::INTERNAL_SERVER_ERROR)
        );
        assert_eq!(
            ErrorCode::InstallFailed {
                app: "Alpha".to_owned()
            }
            .message(),
            "the installation of Alpha failed. See the server's log."
        );
    }
}
