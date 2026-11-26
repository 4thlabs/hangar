//! The errors the page may show, each a stable code with its params beside its English message, so that a catalog can
//! word them in another language later without the server changing.
//!
//! A problem does not carry the code yet: quoll writes its status and detail alone
//! ([quoll#140](https://github.com/4thlabs/quoll/issues/140)), and until it writes more the page shows the detail,
//! which is [`ErrorCode::message`]. A body that holds an error, as the sync of the store's, carries it whole, an
//! [`ErrorDetail`].

use std::fmt;

use http::StatusCode;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// An error the page may show: its code, as `store.unknown_app`, and its params, as `{ "app": "alpha" }`. The server
/// answers it with its [`status`](Self::status) and its English [`message`](Self::message) as the problem's detail.
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
}

/// An error as a body carries it, where a problem does not: its code, its params, and its English message, which the
/// page shows until a catalog words the code.
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
    /// Where the page sends its reader for the rest of a failure of the server's own.
    const LOG_HINT: &str = "See the server's log.";

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
        }
    }

    /// The status the server answers it with.
    pub fn status(&self) -> StatusCode {
        match self {
            Self::UnknownApp { .. } | Self::NoSuchFile { .. } => StatusCode::NOT_FOUND,
            Self::StoreNotInstalled
            | Self::SyncRunning
            | Self::AppExists { .. }
            | Self::FileExists { .. }
            | Self::FileAppeared { .. } => StatusCode::CONFLICT,
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
            | Self::NotAFile { .. }
            | Self::TooLarge { .. }
            | Self::BinaryFile { .. }
            | Self::NotUtf8Text { .. }
            | Self::InvalidFile { .. }
            | Self::ComposeRejected { .. } => StatusCode::BAD_REQUEST,
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
            | Self::AppCreateFailed { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// The message in English, which the page shows until a catalog words the code: a failure of the server's own
    /// sends its reader to the log, where its cause is.
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
    /// The problem of `code`: its status, and its English message as the detail.
    fn from(code: ErrorCode) -> Self {
        Self::new(code.status(), code.message())
    }
}

#[cfg(test)]
mod tests {
    use super::ErrorCode;

    /// One of each code, so that a test sees them all.
    fn every_code() -> Vec<ErrorCode> {
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
