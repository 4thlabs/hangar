//! A command to run: the program, its arguments and its options.

use std::collections::BTreeMap;
use std::path::PathBuf;

use tokio_util::sync::CancellationToken;

/// A command to run through a [`CommandRunner`](crate::CommandRunner): a program, its arguments, the variables set
/// on top of this process's environment, a working directory and a cancellation.
///
/// ```
/// use hangar_core::{CancellationToken, Command};
///
/// let cancellation = CancellationToken::new();
/// let command = Command::new("docker")
///     .args(["compose", "up", "--detach"])
///     .env("TZ", "Europe/Paris")
///     .current_dir("/data/app-installed/web")
///     .cancellation(cancellation.clone());
///
/// // Cancelling the token kills the child while it runs.
/// cancellation.cancel();
/// # drop(command);
/// ```
#[derive(Debug, Clone)]
pub struct Command {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) env: BTreeMap<String, String>,
    pub(crate) current_dir: Option<PathBuf>,
    pub(crate) cancellation: Option<CancellationToken>,
}

impl Command {
    /// A command running `program`, found in the `PATH` unless it is a path, with no arguments.
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            env: BTreeMap::new(),
            current_dir: None,
            cancellation: None,
        }
    }

    /// Adds one argument.
    #[must_use]
    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    /// Adds arguments, in order.
    #[must_use]
    pub fn args(mut self, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    /// Sets a variable for the child, on top of this process's environment, which it otherwise inherits as it is.
    #[must_use]
    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(key.into(), value.into());
        self
    }

    /// Sets variables for the child, as [`env`](Self::env) does for one.
    #[must_use]
    pub fn envs(
        mut self,
        variables: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>,
    ) -> Self {
        self.env.extend(
            variables
                .into_iter()
                .map(|(key, value)| (key.into(), value.into())),
        );
        self
    }

    /// Runs the child in `dir` rather than in this process's working directory.
    #[must_use]
    pub fn current_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.current_dir = Some(dir.into());
        self
    }

    /// Kills the child when `cancellation` is cancelled; the run then fails with [`RunError::Cancelled`]. A command
    /// whose token is already cancelled does not start.
    ///
    /// [`RunError::Cancelled`]: crate::RunError::Cancelled
    #[must_use]
    pub fn cancellation(mut self, cancellation: CancellationToken) -> Self {
        self.cancellation = Some(cancellation);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::Command;

    #[test]
    fn keeps_the_arguments_in_order_and_the_last_value_of_a_variable() {
        let command = Command::new("git")
            .arg("-C")
            .args(["store", "pull", "--ff-only"])
            .env("GIT_TERMINAL_PROMPT", "1")
            .envs([("GIT_TERMINAL_PROMPT", "0")]);

        assert_eq!(command.program, "git");
        assert_eq!(command.args, ["-C", "store", "pull", "--ff-only"]);
        assert_eq!(command.env["GIT_TERMINAL_PROMPT"], "0");
    }
}
