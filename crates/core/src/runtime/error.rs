//! How a run fails.

use std::io;
use std::string::FromUtf8Error;

/// A run that failed: the command did not start, exited with a non-zero code, was killed or cancelled, or the system
/// failed it.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    /// The command could not start, as when the program is not installed.
    #[error("could not run {program}")]
    Spawn {
        /// The program that did not start.
        program: String,
        /// Why it did not.
        #[source]
        source: io::Error,
    },

    /// The command exited with a non-zero code, whatever it printed before: `docker stack deploy` prints its progress
    /// before a failure, which must not pass for a success.
    #[error("{program} exited with code {code}{}", Self::cause(stderr))]
    Failed {
        /// The program that failed.
        program: String,
        /// Its exit code.
        code: i32,
        /// The last lines of its stderr, where the cause is, blank lines left out; empty when the output was
        /// inherited.
        stderr: String,
    },

    /// The command was killed by a signal that this run did not send, as the OOM killer's.
    #[error("{program} was killed by a signal")]
    Killed {
        /// The program that was killed.
        program: String,
        /// The signal, on Unix.
        signal: Option<i32>,
    },

    /// The run was cancelled, by its command's token or by the runtime's, and the child stopped; or it did not start,
    /// cancelled before.
    #[error("{program} was cancelled")]
    Cancelled {
        /// The program that was cancelled.
        program: String,
    },

    /// The run did not start: the runtime was interrupted, as by Ctrl-C in the CLI.
    #[error("{program} was not run: interrupted")]
    Interrupted {
        /// The program that was not run.
        program: String,
    },

    /// The system failed the run once the child started: its output, its exit status, or the kill of a cancelled
    /// child.
    #[error("i/o error while running {program}")]
    Io {
        /// The program the run lost track of.
        program: String,
        /// What the system answered.
        #[source]
        source: io::Error,
    },

    /// A captured stdout is not UTF-8.
    #[error("the output of {program} is not UTF-8")]
    NotUtf8 {
        /// The program that printed it.
        program: String,
        /// Where the bytes stop being UTF-8.
        #[source]
        source: FromUtf8Error,
    },
}

impl RunError {
    /// The exit code a shell gives this failure, which the `hangar` binary exits with: the child's own code, 128 and
    /// the signal for a killed child, 130 for a cancelled or an interrupted run, as after Ctrl-C, and 1 otherwise.
    pub fn exit_code(&self) -> i32 {
        const SIGNALED: i32 = 128;
        const INTERRUPTED: i32 = 130;

        match self {
            Self::Failed { code, .. } => *code,
            Self::Killed {
                signal: Some(signal),
                ..
            } => SIGNALED + signal,
            Self::Cancelled { .. } | Self::Interrupted { .. } => INTERRUPTED,
            Self::Spawn { .. }
            | Self::Killed { signal: None, .. }
            | Self::Io { .. }
            | Self::NotUtf8 { .. } => 1,
        }
    }

    /// The end of the message of [`RunError::Failed`]: its stderr, when it printed some.
    fn cause(stderr: &str) -> String {
        if stderr.is_empty() {
            return String::new();
        }

        format!(": {stderr}")
    }
}

#[cfg(test)]
mod tests {
    use super::RunError;

    #[test]
    fn a_failure_says_its_code_and_its_stderr() {
        let failure = RunError::Failed {
            program: "docker".into(),
            code: 1,
            stderr: "network conflict".into(),
        };

        assert_eq!(
            failure.to_string(),
            "docker exited with code 1: network conflict"
        );
        assert_eq!(failure.exit_code(), 1);
    }

    #[test]
    fn a_failure_with_no_stderr_says_its_code_alone() {
        let failure = RunError::Failed {
            program: "git".into(),
            code: 128,
            stderr: String::new(),
        };

        assert_eq!(failure.to_string(), "git exited with code 128");
    }

    #[test]
    fn a_killed_child_exits_as_a_shell_says() {
        let killed = RunError::Killed {
            program: "docker".into(),
            signal: Some(9),
        };
        let cancelled = RunError::Cancelled {
            program: "docker".into(),
        };

        assert_eq!(killed.exit_code(), 137);
        assert_eq!(cancelled.exit_code(), 130);
    }
}
