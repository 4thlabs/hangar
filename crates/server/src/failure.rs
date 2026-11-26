//! What a failure of the core becomes: the whole of it in the log, and a code of the contract's to the page, which
//! never sees a command's output, where a registry's URL, a host path or an environment value may be.

use std::borrow::Cow;
use std::error::Error as StdError;
use std::sync::LazyLock;

use hangar_api::ErrorCode;
use hangar_core::{ConfigError, StoreError};
use quoll::Error;
use regex::Regex;

/// The credentials of a URL, `user:token@` after its scheme, as `git clone https://user:token@host/store.git`
/// echoes them.
static URL_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s@]+@").expect("the pattern is valid")
});

/// A failure that the server logs whole, and answers with a code of its own.
#[derive(Debug)]
pub(crate) struct Failure;

impl Failure {
    /// `error` and its causes, each after a `: `, as the log writes them, the credentials of a URL taken out: a
    /// failed command's error carries its stderr.
    pub(crate) fn chain(error: &dyn StdError) -> String {
        let mut message = error.to_string();
        let mut source = error.source();

        while let Some(cause) = source {
            message.push_str(": ");
            message.push_str(&cause.to_string());
            source = cause.source();
        }

        Self::redacted(&message).into_owned()
    }

    /// `text` with the credentials of each URL in it replaced by `***`: what a command prints may name the store's
    /// URL with its token, as git does.
    pub(crate) fn redacted(text: &str) -> Cow<'_, str> {
        URL_CREDENTIALS.replace_all(text, "${1}***@")
    }

    /// The answer of `code`, once `error`, its cause, is logged whole beside it.
    pub(crate) fn logged(code: ErrorCode, error: &dyn StdError) -> Error {
        tracing::error!(code = code.code(), error = %Self::chain(error), "{}", code.message());

        code.into()
    }

    /// The answer of a store's `error`: for an invalid `hangar.yml`, its field at fault, which is the user's to fix and
    /// not logged; for any other, `failed`, once `error` is logged whole.
    pub(crate) fn store(failed: ErrorCode, error: &StoreError) -> Error {
        match error {
            StoreError::Config { source, .. } => Self::config(source).into(),
            other => Self::logged(failed, other),
        }
    }

    /// The code of a `hangar.yml` that does not parse: the user's to fix, with the field at fault.
    pub(crate) fn config(error: &ConfigError) -> ErrorCode {
        match error {
            ConfigError::Syntax(source) => ErrorCode::ConfigSyntax {
                reason: source.to_string(),
            },
            ConfigError::Invalid { field, message } => ErrorCode::ConfigInvalid {
                field: field.clone(),
                reason: message.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Failure;

    #[derive(Debug, thiserror::Error)]
    #[error("could not pull the store")]
    struct Outer(#[source] Inner);

    #[derive(Debug, thiserror::Error)]
    #[error("git exited with code 1")]
    struct Inner;

    #[derive(Debug, thiserror::Error)]
    #[error("could not clone the store")]
    struct Clone(#[source] Stderr);

    #[derive(Debug, thiserror::Error)]
    #[error(
        "git exited with code 128: fatal: unable to access 'https://ana:ghp_secret@example.com/store.git/'"
    )]
    struct Stderr;

    #[test]
    fn takes_the_credentials_of_a_url_out() {
        assert_eq!(
            Failure::redacted(
                "Cloning into 'app-store'... from HTTPS://ana:ghp_secret@example.com/store.git"
            ),
            "Cloning into 'app-store'... from HTTPS://***@example.com/store.git"
        );
        assert_eq!(
            Failure::redacted("ssh://git@example.com:22/store.git and https://example.com/a@b"),
            "ssh://***@example.com:22/store.git and https://example.com/a@b"
        );
    }

    #[test]
    fn logs_an_error_without_the_credentials_its_command_printed() {
        use std::io::Write;
        use std::sync::{Arc, Mutex};

        /// A writer into a buffer the test reads.
        #[derive(Clone, Default)]
        struct Captured(Arc<Mutex<Vec<u8>>>);

        impl Write for Captured {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.lock().expect("one writer at a time").write(bytes)
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let log = Captured::default();
        let writer = log.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || writer.clone())
            .with_ansi(false)
            .finish();

        tracing::subscriber::with_default(subscriber, || {
            Failure::logged(hangar_api::ErrorCode::CloneFailed, &Clone(Stderr));
        });

        let written = String::from_utf8(log.0.lock().expect("written").clone()).expect("UTF-8");

        assert!(
            written.contains("https://***@example.com/store.git"),
            "{written}"
        );
        assert!(!written.contains("ghp_secret"), "{written}");
    }

    #[test]
    fn writes_every_cause_after_the_error() {
        assert_eq!(
            Failure::chain(&Outer(Inner)),
            "could not pull the store: git exited with code 1"
        );
    }
}
