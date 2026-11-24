//! The runtime: everything Hangar does to a stack goes through a child command, `docker compose`, `docker stack`,
//! `docker` or `git`. [`CommandRunner`] is what the store and compose call, [`Runtime`] runs real child processes.

mod command;
mod error;
#[cfg(test)]
pub(crate) mod fake;
mod output;
mod process;
mod stderr_tail;

use std::future::Future;

pub use command::Command;
pub use error::RunError;
pub use output::Output;
pub use process::Runtime;

/// Runs child commands. The store and compose take one, so that their tests pass a fake runner instead of running
/// Docker.
pub trait CommandRunner: Send + Sync {
    /// Runs `command`, its output going where `output` says, and waits for it to exit.
    ///
    /// # Errors
    ///
    /// Returns a [`RunError`] when the command cannot start, exits with a non-zero code, is killed, cancelled or
    /// interrupted.
    fn run(
        &self,
        command: &Command,
        output: Output,
    ) -> impl Future<Output = Result<(), RunError>> + Send;

    /// Runs `command` and returns its stdout alone, so that it stays parseable; stderr only feeds the error.
    ///
    /// # Errors
    ///
    /// Returns a [`RunError`] as [`run`](Self::run) does, and when stdout is not UTF-8.
    fn capture(&self, command: &Command) -> impl Future<Output = Result<String, RunError>> + Send;
}
