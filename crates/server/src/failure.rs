//! What a failure of the core becomes: the whole of it in the log, and a code of the contract's to the page, which
//! never sees a command's output, where a registry's URL, a host path or an environment value may be.

use std::error::Error as StdError;

use hangar_api::ErrorCode;
use hangar_core::ConfigError;
use quoll::Error;

/// A failure that the server logs whole, and answers with a code of its own.
#[derive(Debug)]
pub(crate) struct Failure;

impl Failure {
    /// `error` and its causes, each after a `: `, as the log writes them.
    pub(crate) fn chain(error: &dyn StdError) -> String {
        let mut message = error.to_string();
        let mut source = error.source();

        while let Some(cause) = source {
            message.push_str(": ");
            message.push_str(&cause.to_string());
            source = cause.source();
        }

        message
    }

    /// The answer of `code`, once `error`, its cause, is logged whole beside it.
    pub(crate) fn logged(code: ErrorCode, error: &dyn StdError) -> Error {
        tracing::error!(code = code.code(), error = %Self::chain(error), "{}", code.message());

        code.into()
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

    #[test]
    fn writes_every_cause_after_the_error() {
        assert_eq!(
            Failure::chain(&Outer(Inner)),
            "could not pull the store: git exited with code 1"
        );
    }
}
