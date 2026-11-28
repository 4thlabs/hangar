//! A command to run: the program, its arguments and its options.

use std::collections::{BTreeMap, BTreeSet};
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
/// // Cancelling the token stops the child while it runs: SIGTERM, then SIGKILL after the grace period.
/// cancellation.cancel();
/// # drop(command);
/// ```
#[derive(Debug, Clone)]
pub struct Command {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) env: BTreeMap<String, String>,
    /// The variables the child does not inherit, whatever this process's environment or the runtime's set.
    pub(crate) env_removed: BTreeSet<String>,
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
            env_removed: BTreeSet::new(),
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
        let key = key.into();

        self.env_removed.remove(&key);
        self.env.insert(key, value.into());
        self
    }

    /// Sets variables for the child, as [`env`](Self::env) does for one.
    #[must_use]
    pub fn envs(
        mut self,
        variables: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>,
    ) -> Self {
        for (key, value) in variables {
            self = self.env(key, value);
        }

        self
    }

    /// Leaves the variable `key` out of the child's environment, whatever this process's environment, the runtime's or
    /// this command's set: `COMPOSE_FILE`, as one that names no file must not be read a file.
    #[must_use]
    pub fn env_remove(mut self, key: impl Into<String>) -> Self {
        let key = key.into();

        self.env.remove(&key);
        self.env_removed.insert(key);
        self
    }

    /// Runs the child in `dir` rather than in this process's working directory.
    #[must_use]
    pub fn current_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.current_dir = Some(dir.into());
        self
    }

    /// Stops the child when `cancellation` is cancelled, with SIGTERM, then SIGKILL 10 seconds later if it is still
    /// there; the run then fails with [`RunError::Cancelled`], by the cut that [`Runtime`](crate::Runtime)
    /// describes. A command whose token is already cancelled does not start.
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
