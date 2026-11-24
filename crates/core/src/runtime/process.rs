//! The runner of real child processes, on `tokio::process`.

mod child;
mod reader;

use std::future::Future;
use std::io;
use std::pin::{Pin, pin};
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use self::child::{ChildCount, RunningChild};
use self::reader::Reader;
use super::stderr_tail::StderrTail;
use super::{Command, CommandRunner, Output, RunError};

/// Runs commands as child processes. A clone shares its children, its interruption and its cancellation.
///
/// It has two controls, as Ctrl-C in the CLI and a cancel need different things:
///
/// - [`interrupt`](Self::interrupt) refuses the runs to come and lets the running ones end, which a terminal's
///   Ctrl-C has reached already;
/// - a cancellation, the command's [`cancellation`](Command::cancellation) or the runtime's
///   [`with_cancellation`](Self::with_cancellation), stops a running child: SIGTERM, then SIGKILL 10 seconds later
///   if it is still there. A run that is dropped stops its child the same way.
///
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), hangar_core::RunError> {
/// use hangar_core::{Command, CommandRunner, Runtime};
///
/// let runtime = Runtime::new();
/// let stdout = runtime.capture(&Command::new("echo").arg("hangar")).await?;
///
/// assert_eq!(stdout, "hangar\n");
/// # Ok(())
/// # }
/// ```
///
/// The CLI, on Ctrl-C:
///
/// ```no_run
/// use hangar_core::Runtime;
///
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() {
/// let runtime = Runtime::new();
/// let on_ctrl_c = runtime.clone();
///
/// tokio::spawn(async move {
///     if tokio::signal::ctrl_c().await.is_ok() {
///         on_ctrl_c.interrupt();
///         on_ctrl_c.idle().await;
///         std::process::exit(130);
///     }
/// });
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct Runtime {
    interrupted: Arc<AtomicBool>,
    children: Arc<ChildCount>,
    cancellation: CancellationToken,
    /// How long a child has between SIGTERM and SIGKILL.
    grace: Duration,
}

/// What a run does with the child's output.
#[derive(Debug)]
enum Destination {
    /// Sends stdout and stderr to an [`Output`].
    Output(Output),
    /// Keeps stdout, and stderr only for a failure.
    Capture,
}

impl Default for Runtime {
    fn default() -> Self {
        Self::with_cancellation(CancellationToken::new())
    }
}

impl Runtime {
    /// How long a stopped child has between SIGTERM and SIGKILL, as `docker stop` gives a container.
    const GRACE: Duration = Duration::from_secs(10);

    /// A runtime that nothing cancels but the tokens of its commands.
    pub fn new() -> Self {
        Self::default()
    }

    /// A runtime that `cancellation` stops, as a server that shuts down: cancelling it stops the children running
    /// and fails the runs to come with [`RunError::Cancelled`].
    pub fn with_cancellation(cancellation: CancellationToken) -> Self {
        Self {
            interrupted: Arc::new(AtomicBool::new(false)),
            children: Arc::new(ChildCount::new()),
            cancellation,
            grace: Self::GRACE,
        }
    }

    /// Refuses the runs to come, which fail with [`RunError::Interrupted`], and lets the running children end: on
    /// Ctrl-C, the terminal sent them SIGINT already. The CLI then exits once [`idle`](Self::idle) resolves.
    pub fn interrupt(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    /// Resolves once no child of this runtime, its clones included, is running. A child whose run was dropped counts
    /// until it is stopped.
    pub async fn idle(&self) {
        self.children.idle().await;
    }

    /// Runs `command` to its end, or until it is cancelled, and returns its stdout when `destination` captures it.
    async fn execute(
        &self,
        command: &Command,
        destination: Destination,
    ) -> Result<Vec<u8>, RunError> {
        let program = || command.program.clone();

        if self.interrupted.load(Ordering::SeqCst) {
            return Err(RunError::Interrupted { program: program() });
        }

        if self.is_cancelled(command) {
            return Err(RunError::Cancelled { program: program() });
        }

        let mut child = self.spawn(command, &destination)?;
        let stdout_pipe = child.child().stdout.take();
        let stderr_pipe = child.child().stderr.take();
        let mut stdout = Reader::stdout(&destination);
        let mut stderr = Reader::stderr(&destination);
        let exited = CancellationToken::new();

        let outcome = {
            let reading = pin!(Reader::read_both(
                &mut stdout,
                stdout_pipe,
                &mut stderr,
                stderr_pipe,
                &exited
            ));

            self.follow(command, &mut child, reading, &exited).await
        };

        stdout.finish().await;
        stderr.finish().await;

        let (status, read) = outcome?;

        Self::check(command, status, stderr.into_tail())?;

        read.map_err(|source| RunError::Io {
            program: program(),
            source,
        })?;

        Ok(stdout.into_captured())
    }

    /// Starts the child, its stdin closed and its output piped, unless it inherits this process's.
    fn spawn(
        &self,
        command: &Command,
        destination: &Destination,
    ) -> Result<RunningChild, RunError> {
        let mut process = tokio::process::Command::new(&command.program);

        // `RunningChild` stops a child gracefully; this is the last resort, when no runtime is left to do it.
        process
            .args(&command.args)
            .envs(&command.env)
            .kill_on_drop(true);

        if let Some(dir) = &command.current_dir {
            process.current_dir(dir);
        }

        if !matches!(destination, Destination::Output(Output::Inherit)) {
            process
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        }

        let child = process.spawn().map_err(|source| RunError::Spawn {
            program: command.program.clone(),
            source,
        })?;

        Ok(RunningChild::new(child, &self.children, self.grace))
    }

    /// Follows the child to its exit while `reading` reads its pipes, and stops it when the run is cancelled first.
    /// Returns its exit status and how the reading went.
    async fn follow(
        &self,
        command: &Command,
        child: &mut RunningChild,
        mut reading: Pin<&mut impl Future<Output = io::Result<()>>>,
        exited: &CancellationToken,
    ) -> Result<(ExitStatus, io::Result<()>), RunError> {
        let io_error = |source| RunError::Io {
            program: command.program.clone(),
            source,
        };
        let mut read = None;

        let status = RunningChild::wait_reading(
            child.child(),
            reading.as_mut(),
            &mut read,
            self.cancelled(command),
        )
        .await;

        let Some(status) = status else {
            child.stop(reading, &mut read).await.map_err(io_error)?;

            return Err(RunError::Cancelled {
                program: command.program.clone(),
            });
        };

        let status = status.map_err(io_error)?;

        // The child is gone: what is left in its pipes is read, for a bounded time. A cancel now ends that reading
        // and keeps the exit status, which is the run's outcome.
        exited.cancel();

        if read.is_none() {
            tokio::select! {
                result = reading => read = Some(result),
                () = self.cancelled(command) => {}
            }
        }

        Ok((status, read.unwrap_or(Ok(()))))
    }

    /// Fails a run that did not exit with code 0, whatever it printed.
    fn check(command: &Command, status: ExitStatus, stderr: StderrTail) -> Result<(), RunError> {
        let program = command.program.clone();

        match status.code() {
            Some(0) => Ok(()),
            Some(code) => Err(RunError::Failed {
                program,
                code,
                stderr: stderr.finish(),
            }),
            None => Err(RunError::Killed {
                program,
                signal: Self::signal(status),
            }),
        }
    }

    /// The signal that killed a child.
    #[cfg(unix)]
    fn signal(status: ExitStatus) -> Option<i32> {
        std::os::unix::process::ExitStatusExt::signal(&status)
    }

    /// The signal that killed a child: none outside Unix.
    #[cfg(not(unix))]
    fn signal(_status: ExitStatus) -> Option<i32> {
        None
    }

    /// Whether the runtime or the command was cancelled before the run.
    fn is_cancelled(&self, command: &Command) -> bool {
        let is_command_cancelled = command
            .cancellation
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled);

        self.cancellation.is_cancelled() || is_command_cancelled
    }

    /// Resolves once the runtime or the command is cancelled.
    async fn cancelled(&self, command: &Command) {
        let Some(token) = &command.cancellation else {
            return self.cancellation.cancelled().await;
        };

        tokio::select! {
            () = self.cancellation.cancelled() => {}
            () = token.cancelled() => {}
        }
    }
}

impl CommandRunner for Runtime {
    async fn run(&self, command: &Command, output: Output) -> Result<(), RunError> {
        self.execute(command, Destination::Output(output))
            .await
            .map(drop)
    }

    async fn capture(&self, command: &Command) -> Result<String, RunError> {
        let stdout = self.execute(command, Destination::Capture).await?;

        String::from_utf8(stdout).map_err(|source| RunError::NotUtf8 {
            program: command.program.clone(),
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::mpsc;

    use super::Runtime;
    use crate::{CancellationToken, Command, CommandRunner, Output, RunError};

    #[cfg(unix)]
    #[tokio::test]
    async fn kills_a_child_that_ignores_sigterm_once_the_grace_period_is_over() {
        let runtime = Runtime {
            grace: Duration::from_millis(100),
            ..Runtime::new()
        };
        let cancellation = CancellationToken::new();
        let (sender, mut receiver) = mpsc::channel(16);
        let command = Command::new("sh")
            .args(["-c", "trap '' TERM; echo $$; exec sleep 60"])
            .cancellation(cancellation.clone());

        let run = runtime.run(&command, Output::Lines(sender));
        let cancel_once_started = async {
            let pid = receiver.recv().await.expect("the child prints its pid");

            cancellation.cancel();

            pid
        };

        let (failure, pid) = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(run, cancel_once_started)
        })
        .await
        .expect("SIGKILL ends the child that ignores SIGTERM");

        assert!(matches!(failure, Err(RunError::Cancelled { .. })));
        assert!(!is_running(&pid), "the child is gone");
    }

    /// Whether the process whose pid a child printed still runs.
    #[cfg(unix)]
    fn is_running(printed_pid: &[u8]) -> bool {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;

        let pid = String::from_utf8_lossy(printed_pid)
            .trim()
            .parse()
            .expect("the child printed its pid");

        kill(Pid::from_raw(pid), None).is_ok()
    }
}
