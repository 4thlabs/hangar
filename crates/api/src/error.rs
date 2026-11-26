//! The errors the page may show, each a stable code with its params beside its English message, so that a catalog can
//! word them in another language later without the server changing.
//!
//! The code is not on the wire yet: quoll writes a problem's status and detail alone
//! ([quoll#140](https://github.com/4thlabs/quoll/issues/140)). Until it writes more, the page shows the detail, which
//! is [`ErrorCode::message`].

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
        }
    }

    /// The status the server answers it with.
    pub fn status(&self) -> StatusCode {
        match self {
            Self::UnknownApp { .. } => StatusCode::NOT_FOUND,
            Self::StoreNotInstalled => StatusCode::CONFLICT,
            Self::ConfigSyntax { .. }
            | Self::ConfigInvalid { .. }
            | Self::InvalidVariableName { .. }
            | Self::LineBreak { .. }
            | Self::UnwritableValue { .. } => StatusCode::BAD_REQUEST,
            Self::AppsUnreadable
            | Self::InstallFailed { .. }
            | Self::UninstallFailed { .. }
            | Self::CloneFailed
            | Self::PullFailed
            | Self::ConfigUnreadable
            | Self::ConfigSaveFailed
            | Self::EnvUnreadable
            | Self::EnvSaveFailed => StatusCode::INTERNAL_SERVER_ERROR,
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
