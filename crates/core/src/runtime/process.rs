//! The runner of real child processes, on `tokio::process`.

mod children;
mod reader;
mod supervisor;

use std::io;
use std::pin::pin;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::Duration;

use tokio::process::Child;
use tokio_util::sync::CancellationToken;

use self::children::{Children, Counted};
use self::reader::Reader;
use self::supervisor::Supervisor;
use super::stderr_tail::StderrTail;
use super::{Command, CommandRunner, Output, RunError};

/// Runs commands as child processes. A clone shares its children, its interruption and its cancellation.
///
/// It has two controls, as Ctrl-C in the CLI and a cancel need different things:
///
/// - [`interrupt`](Self::interrupt) refuses the runs to come and lets the running ones end, which a terminal's
///   Ctrl-C has reached already;
/// - a cancellation, the command's [`cancellation`](Command::cancellation) or the runtime's
///   [`with_cancellation`](Self::with_cancellation), stops a running child: SIGTERM once, then SIGKILL 10 seconds
///   later if it is still there, its output read all along. A run that is dropped stops its child the same way.
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
/// The CLI, on Ctrl-C: the terminal sent SIGINT to the running child, which ends, and nothing new starts.
///
/// ```no_run
/// use std::pin::pin;
///
/// use hangar_core::{Command, CommandRunner, Output, Runtime};
///
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() {
/// let runtime = Runtime::new();
/// let mut up = pin!(async {
///     let command = Command::new("docker").args(["compose", "up", "--detach"]);
///
///     runtime.run(&command, Output::Inherit).await
/// });
///
/// let outcome = tokio::select! {
///     outcome = &mut up => outcome,
///     _ = tokio::signal::ctrl_c() => {
///         runtime.interrupt();
///         up.await
///     }
/// };
///
/// std::process::exit(outcome.map_or_else(|error| error.exit_code(), |()| 0));
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct Runtime {
    children: Arc<Children>,
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
            children: Arc::new(Children::new()),
            cancellation,
            grace: Self::GRACE,
        }
    }

    /// Refuses the runs to come, which fail with [`RunError::Interrupted`], and lets the running children end: on
    /// Ctrl-C, the terminal sent them SIGINT already.
    pub fn interrupt(&self) {
        self.children.interrupt();
    }

    /// Resolves once no child of this runtime, its clones included, is running. A child whose run was dropped counts
    /// until it exits.
    ///
    /// The children are counted until they exit, not until their runs return: a run may still be forwarding its last
    /// lines when this resolves. A caller that shows the output awaits its runs instead, as the CLI does on Ctrl-C.
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

        // Counted before it starts, so that an interruption either refuses it or waits for it.
        let Some(counted) = self.children.enter() else {
            return Err(RunError::Interrupted { program: program() });
        };

        if self.is_cancelled(command) {
            return Err(RunError::Cancelled { program: program() });
        }

        let child = Self::spawn(command, &destination)?;
        let stop = CancellationToken::new();

        // A run dropped asks its child to stop, as a cancelled one does.
        let _stop_on_drop = stop.clone().drop_guard();

        let exit = self.supervise(child, counted, &destination, &stop).start();

        let exit = {
            let mut exit = pin!(exit);

            tokio::select! {
                biased;
                exit = &mut exit => exit,
                () = self.cancelled(command) => {
                    stop.cancel();
                    exit.await
                }
            }
        };

        let exit = exit.map_err(|_| RunError::Io {
            program: program(),
            source: io::Error::other("the task following the child ended without its exit"),
        })?;

        // A lost pipe stops the child: its read error, not the signal, is the cause.
        let status = exit.status.map_err(|source| RunError::Io {
            program: program(),
            source,
        })?;

        exit.read.map_err(|source| RunError::Io {
            program: program(),
            source,
        })?;

        if exit.stopped {
            return Err(RunError::Cancelled { program: program() });
        }

        Self::check(command, status, exit.stderr)?;

        Ok(exit.stdout)
    }

    /// Starts the child, its stdin closed and its output piped, unless it inherits this process's.
    fn spawn(command: &Command, destination: &Destination) -> Result<Child, RunError> {
        let mut process = tokio::process::Command::new(&command.program);

        // Its supervisor stops a child gracefully; this is the last resort, when the tokio runtime shuts down.
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

        process.spawn().map_err(|source| RunError::Spawn {
            program: command.program.clone(),
            source,
        })
    }

    /// The supervisor of `child`, reading its output where `destination` says, which `stop` asks to stop it.
    fn supervise(
        &self,
        child: Child,
        counted: Counted,
        destination: &Destination,
        stop: &CancellationToken,
    ) -> Supervisor {
        Supervisor {
            child,
            counted,
            stdout: Reader::stdout(destination, stop),
            stderr: Reader::stderr(destination, stop),
            stop: stop.clone(),
            grace: self.grace,
        }
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
    use std::future::Future;
    use std::path::PathBuf;
    use std::time::Duration;

    use tokio::sync::mpsc;

    use super::Runtime;
    use crate::{CancellationToken, Command, CommandRunner, Output, RunError};

    /// How long a test waits for what it checks before it fails, rather than hang.
    const DEADLINE: Duration = Duration::from_secs(10);

    /// Awaits `future`, failing the test past [`DEADLINE`].
    async fn within_deadline<T>(future: impl Future<Output = T>) -> T {
        tokio::time::timeout(DEADLINE, future)
            .await
            .expect("the test is over before its deadline")
    }

    /// A runtime whose children have `grace` between SIGTERM and SIGKILL.
    fn runtime_with_grace(grace: Duration) -> Runtime {
        Runtime {
            grace,
            ..Runtime::new()
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn kills_a_child_that_ignores_sigterm_once_the_grace_period_is_over() {
        let runtime = runtime_with_grace(Duration::from_millis(100));
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

        let (failure, pid) =
            within_deadline(async { tokio::join!(run, cancel_once_started) }).await;

        assert!(matches!(failure, Err(RunError::Cancelled { .. })));
        assert!(!is_running(&pid), "the child is gone");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sends_one_sigterm_to_a_child_whose_cancelled_run_is_dropped() {
        let runtime = runtime_with_grace(Duration::from_millis(300));
        let marker = Marker::new("one-sigterm");
        let cancellation = CancellationToken::new();
        let (sender, mut receiver) = mpsc::channel(16);

        // It writes a line per SIGTERM it gets, and goes on until SIGKILL.
        let command = Command::new("sh")
            .args([
                "-c",
                r#"trap 'echo term >> "$1"' TERM; echo started; while :; do sleep 0.05; done"#,
                "sh",
                marker.path(),
            ])
            .cancellation(cancellation.clone());
        let running = runtime.clone();

        let run = tokio::spawn(async move { running.run(&command, Output::Lines(sender)).await });

        within_deadline(receiver.recv())
            .await
            .expect("the child says it started");
        cancellation.cancel();
        tokio::task::yield_now().await;
        run.abort();
        within_deadline(runtime.idle()).await;

        let signals = std::fs::read_to_string(&marker.0).expect("the child got SIGTERM");

        assert_eq!(signals, "term\n");
    }

    /// A file in the temporary directory, which a child writes to tell the test something; removed with it.
    struct Marker(PathBuf);

    impl Marker {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("hangar-runtime-unit-{}-{name}", std::process::id()));

            Self(path)
        }

        fn path(&self) -> &str {
            self.0.to_str().expect("a UTF-8 temporary directory")
        }
    }

    impl Drop for Marker {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
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
