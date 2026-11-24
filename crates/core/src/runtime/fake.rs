//! A fake runner, for the tests of what runs commands: it records them and answers what the test told it to.

use std::collections::VecDeque;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use super::output::Forward;
use super::stderr_tail::StderrTail;
use super::{Command, CommandRunner, Output, RunError};

/// What the fake runner answers a command.
#[derive(Debug, Clone)]
pub(crate) enum Reply {
    /// Exits with code 0 after printing `stdout`: to the sink for a run, as the result for a capture.
    Success { stdout: String },
    /// Exits with `code` after printing `stderr`.
    Failure { code: i32, stderr: String },
}

/// A [`CommandRunner`] that runs nothing: it records each command and answers it with the next reply it was given,
/// or a silent success once there is none left.
#[derive(Debug, Default)]
pub(crate) struct FakeRunner {
    runs: Mutex<Vec<Command>>,
    replies: Mutex<VecDeque<Reply>>,
}

impl FakeRunner {
    /// A fake runner with no reply yet: every command succeeds and prints nothing.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Queues the answer to the next command not answered yet.
    pub(crate) fn reply(&self, reply: Reply) -> &Self {
        self.replies
            .lock()
            .expect("no test panics while holding the lock")
            .push_back(reply);
        self
    }

    /// The commands run so far, in order.
    pub(crate) fn runs(&self) -> Vec<Command> {
        self.runs
            .lock()
            .expect("no test panics while holding the lock")
            .clone()
    }

    /// Records `command` and takes its reply; a command cancelled before it starts runs nothing, as with
    /// [`Runtime`](crate::Runtime).
    fn answer(&self, command: &Command) -> Result<Reply, RunError> {
        let is_cancelled = command
            .cancellation
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled);

        if is_cancelled {
            return Err(RunError::Cancelled {
                program: command.program.clone(),
            });
        }

        self.runs
            .lock()
            .expect("no test panics while holding the lock")
            .push(command.clone());

        let reply = self
            .replies
            .lock()
            .expect("no test panics while holding the lock")
            .pop_front()
            .unwrap_or(Reply::Success {
                stdout: String::new(),
            });

        Ok(reply)
    }

    /// Prints `text` where `output` says.
    async fn print(output: &Output, text: &str) {
        let Some(mut forward) = Forward::new(output, &CancellationToken::new()) else {
            return;
        };

        forward.write(text.as_bytes()).await;
        forward.finish().await;
    }

    /// The failure of `command`, with its stderr's tail as a real run keeps it.
    fn failure(command: &Command, code: i32, stderr: &str) -> RunError {
        let mut tail = StderrTail::default();

        tail.write(stderr.as_bytes());

        RunError::Failed {
            program: command.program.clone(),
            code,
            stderr: tail.finish(),
        }
    }
}

impl CommandRunner for FakeRunner {
    async fn run(&self, command: &Command, output: Output) -> Result<(), RunError> {
        match self.answer(command)? {
            Reply::Success { stdout } => {
                Self::print(&output, &stdout).await;

                Ok(())
            }
            Reply::Failure { code, stderr } => {
                Self::print(&output, &stderr).await;

                Err(Self::failure(command, code, &stderr))
            }
        }
    }

    async fn capture(&self, command: &Command) -> Result<String, RunError> {
        match self.answer(command)? {
            Reply::Success { stdout } => Ok(stdout),
            Reply::Failure { code, stderr } => Err(Self::failure(command, code, &stderr)),
        }
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;

    use super::{FakeRunner, Reply};
    use crate::{CancellationToken, Command, CommandRunner, Output, RunError};

    #[tokio::test]
    async fn records_the_commands_in_order() {
        let runner = FakeRunner::new();

        runner
            .run(
                &Command::new("git").args(["pull", "--ff-only"]),
                Output::Inherit,
            )
            .await
            .expect("a fake run with no reply succeeds");
        runner
            .capture(
                &Command::new("docker")
                    .args(["compose", "ls"])
                    .env("TZ", "UTC"),
            )
            .await
            .expect("a fake capture with no reply succeeds");

        let runs = runner.runs();

        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].program, "git");
        assert_eq!(runs[0].args, ["pull", "--ff-only"]);
        assert_eq!(runs[1].args, ["compose", "ls"]);
        assert_eq!(runs[1].env["TZ"], "UTC");
    }

    #[tokio::test]
    async fn answers_with_the_replies_in_order_then_succeeds() {
        let runner = FakeRunner::new();
        let command = Command::new("docker");

        runner
            .reply(Reply::Success {
                stdout: "[]".into(),
            })
            .reply(Reply::Failure {
                code: 1,
                stderr: "daemon down\n".into(),
            });

        assert_eq!(runner.capture(&command).await.expect("replied"), "[]");

        let failure = runner
            .capture(&command)
            .await
            .expect_err("the second reply fails");

        assert!(matches!(
            failure,
            RunError::Failed { code: 1, ref stderr, .. } if stderr == "daemon down"
        ));
        assert_eq!(runner.capture(&command).await.expect("no reply left"), "");
    }

    #[tokio::test]
    async fn streams_its_reply_to_the_channel() {
        let runner = FakeRunner::new();
        let (sender, mut receiver) = mpsc::channel(16);

        runner.reply(Reply::Failure {
            code: 1,
            stderr: "Creating web\nnetwork conflict\n".into(),
        });

        let failure = runner
            .run(&Command::new("docker"), Output::Lines(sender))
            .await
            .expect_err("the reply fails");

        assert_eq!(failure.exit_code(), 1);
        assert_eq!(
            receiver.recv().await.expect("a first line"),
            b"Creating web\n"
        );
        assert_eq!(
            receiver.recv().await.expect("a second line"),
            b"network conflict\n"
        );
    }

    #[tokio::test]
    async fn runs_nothing_for_a_command_cancelled_before() {
        let runner = FakeRunner::new();
        let cancellation = CancellationToken::new();

        cancellation.cancel();
        runner.reply(Reply::Success {
            stdout: "for the next command".into(),
        });

        let failure = runner
            .capture(&Command::new("docker").cancellation(cancellation))
            .await
            .expect_err("a cancelled command fails");

        assert!(matches!(failure, RunError::Cancelled { .. }));
        assert!(runner.runs().is_empty());
        assert_eq!(
            runner
                .capture(&Command::new("docker"))
                .await
                .expect("replied"),
            "for the next command"
        );
    }
}
