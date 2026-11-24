//! The runner of real child processes, on `tokio::process`.

use std::io;
use std::process::{ExitStatus, Stdio};

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, ChildStderr, ChildStdout};
use tokio_util::sync::CancellationToken;

use super::output::Forward;
use super::stderr_tail::StderrTail;
use super::{Command, CommandRunner, Output, RunError};

/// Runs commands as child processes. A clone shares its cancellation.
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
#[derive(Debug, Clone, Default)]
pub struct Runtime {
    cancellation: CancellationToken,
}

/// What a run does with the child's output.
enum Destination {
    /// Sends stdout and stderr to an [`Output`].
    Output(Output),
    /// Keeps stdout, and stderr only for a failure.
    Capture,
}

/// What a child left once it exited.
struct Exit {
    status: io::Result<ExitStatus>,
    /// Whether its stdout and stderr were read to the end.
    read: io::Result<()>,
    stdout: Vec<u8>,
    stderr: StderrTail,
}

impl Runtime {
    /// The size of a read from a child's pipe.
    const READ_BYTES: usize = 8 * 1024;

    /// A runtime that nothing cancels but the tokens of its commands.
    pub fn new() -> Self {
        Self::default()
    }

    /// A runtime that `cancellation` stops: cancelling it kills the children running and fails the runs to come, as
    /// Ctrl-C does in the CLI.
    pub fn with_cancellation(cancellation: CancellationToken) -> Self {
        Self { cancellation }
    }

    /// Runs `command` to its end, or until it is cancelled, and returns its stdout when `destination` captures it.
    async fn execute(
        &self,
        command: &Command,
        destination: Destination,
    ) -> Result<Vec<u8>, RunError> {
        let program = || command.program.clone();

        if self.is_cancelled(command) {
            return Err(RunError::Cancelled { program: program() });
        }

        let mut child = Self::spawn(command, &destination)?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let exit = tokio::select! {
            biased;
            exit = Self::wait(&mut child, stdout, stderr, &destination) => Some(exit),
            () = self.cancelled(command) => None,
        };

        let Some(exit) = exit else {
            child.kill().await.map_err(|source| RunError::Io {
                program: program(),
                source,
            })?;

            return Err(RunError::Cancelled { program: program() });
        };

        let status = exit.status.map_err(|source| RunError::Io {
            program: program(),
            source,
        })?;

        Self::check(command, status, exit.stderr)?;

        exit.read.map_err(|source| RunError::Io {
            program: program(),
            source,
        })?;

        Ok(exit.stdout)
    }

    /// Starts the child, its stdin closed and its output piped, unless it inherits this process's.
    fn spawn(command: &Command, destination: &Destination) -> Result<Child, RunError> {
        let mut process = tokio::process::Command::new(&command.program);

        // Dropping a run, as a caller that goes away does, must not leave its child behind.
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

    /// Reads the child's output where `destination` says, and waits for it to exit.
    async fn wait(
        child: &mut Child,
        stdout: Option<ChildStdout>,
        stderr: Option<ChildStderr>,
        destination: &Destination,
    ) -> Exit {
        let is_captured = matches!(destination, Destination::Capture);
        let (mut stdout_forward, mut stderr_forward) = match destination {
            Destination::Output(output) => (Forward::new(output), Forward::new(output)),
            Destination::Capture => (None, None),
        };
        let mut captured = Vec::new();
        let mut tail = StderrTail::default();

        let (status, stdout_read, stderr_read) = tokio::join!(
            child.wait(),
            Self::read(stdout, |chunk| {
                if is_captured {
                    captured.extend_from_slice(chunk);
                }

                if let Some(forward) = &mut stdout_forward {
                    forward.write(chunk);
                }
            }),
            Self::read(stderr, |chunk| {
                tail.write(chunk);

                if let Some(forward) = &mut stderr_forward {
                    forward.write(chunk);
                }
            }),
        );

        for forward in [&mut stdout_forward, &mut stderr_forward]
            .into_iter()
            .flatten()
        {
            forward.finish();
        }

        Exit {
            status,
            read: stdout_read.and(stderr_read),
            stdout: captured,
            stderr: tail,
        }
    }

    /// Hands each chunk of `pipe` to `on_chunk` until it closes; an inherited stream has no pipe.
    async fn read(
        pipe: Option<impl AsyncRead + Unpin>,
        mut on_chunk: impl FnMut(&[u8]),
    ) -> io::Result<()> {
        let Some(mut pipe) = pipe else {
            return Ok(());
        };

        let mut buffer = vec![0; Self::READ_BYTES];

        loop {
            let read = pipe.read(&mut buffer).await?;

            if read == 0 {
                return Ok(());
            }

            on_chunk(&buffer[..read]);
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
