//! The task that owns a child: its process, its pipes and its count, and the only one that signals it.

use std::future;
use std::io;
use std::pin::pin;
use std::process::ExitStatus;
use std::time::Duration;

use tokio::process::Child;
use tokio::sync::oneshot;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::children::Counted;
use super::reader::Reader;
use crate::runtime::stderr_tail::StderrTail;

/// Follows a child from its start to its exit, in a task of its own, so that a run cancelled and a run dropped stop it
/// the same way: SIGTERM once, its pipes read meanwhile, so that what it prints as it stops does not kill it with
/// SIGPIPE, then SIGKILL after the grace period.
#[derive(Debug)]
pub(super) struct Supervisor {
    pub(super) child: Child,
    pub(super) counted: Counted,
    pub(super) stdout: Reader,
    pub(super) stderr: Reader,
    /// Asks for the child to stop: the run's cancellation, or the run dropped.
    pub(super) stop: CancellationToken,
    /// How long the child has between SIGTERM and SIGKILL.
    pub(super) grace: Duration,
}

/// What a child left once it exited.
#[derive(Debug)]
pub(super) struct Exit {
    pub(super) status: io::Result<ExitStatus>,
    /// Whether its pipes were read to their end, or to the silence that follows its exit.
    pub(super) read: io::Result<()>,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: StderrTail,
    /// Whether it was asked to stop before it exited, which makes the run cancelled.
    pub(super) stopped: bool,
}

/// Where the stop of a child is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    /// Nobody asked for it.
    NotAsked,
    /// SIGTERM was sent; SIGKILL follows at the deadline.
    Terminated { kill_at: Instant },
    /// SIGKILL was sent.
    Killed,
}

impl Supervisor {
    /// Spawns the task, which reports the exit on the receiver; the task goes on if the receiver is dropped.
    pub(super) fn start(self) -> oneshot::Receiver<Exit> {
        let (sender, receiver) = oneshot::channel();

        tokio::spawn(async move {
            // A run that went away does not wait for the exit.
            let _ = sender.send(self.supervise().await);
        });

        receiver
    }

    /// Reads the pipes and waits for the child to exit, stopping it when asked; then reads what is left in its
    /// pipes, which ends at their close or after a silence.
    async fn supervise(self) -> Exit {
        let Self {
            mut child,
            counted,
            mut stdout,
            mut stderr,
            stop,
            grace,
        } = self;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let exited = CancellationToken::new();
        let mut state = Stop::NotAsked;
        let mut read = None;

        let status = {
            let mut reading = pin!(Reader::read_both(
                &mut stdout,
                stdout_pipe,
                &mut stderr,
                stderr_pipe,
                &exited
            ));

            let status = loop {
                tokio::select! {
                    biased;
                    status = child.wait() => break status,
                    result = reading.as_mut(), if read.is_none() => read = Some(result),
                    () = stop.cancelled(), if state == Stop::NotAsked => {
                        state = Self::terminate(&mut child, grace);
                    }
                    () = Self::deadline(state) => state = Self::kill(&mut child),
                }
            };

            // The child is reaped: it no longer holds back a CLI waiting for its children.
            drop(counted);
            exited.cancel();

            if read.is_none() {
                read = Some(reading.await);
            }

            status
        };

        stdout.finish().await;
        stderr.finish().await;

        Exit {
            status,
            read: read.unwrap_or(Ok(())),
            stdout: stdout.into_captured(),
            stderr: stderr.into_tail(),
            stopped: state != Stop::NotAsked,
        }
    }

    /// Sends SIGTERM, which lets the child stop what it runs, as `docker compose` its plugin; SIGKILL at once when it
    /// cannot be sent.
    fn terminate(child: &mut Child, grace: Duration) -> Stop {
        match Self::send_sigterm(child) {
            Ok(()) => Stop::Terminated {
                kill_at: Instant::now() + grace,
            },
            Err(error) => {
                tracing::warn!(%error, "could not send SIGTERM to a child, killing it");

                Self::kill(child)
            }
        }
    }

    /// Sends SIGKILL.
    fn kill(child: &mut Child) -> Stop {
        if let Err(error) = child.start_kill() {
            tracing::warn!(%error, "could not kill a child");
        }

        Stop::Killed
    }

    /// Resolves at the deadline of a SIGTERM, and never otherwise.
    async fn deadline(state: Stop) {
        let Stop::Terminated { kill_at } = state else {
            return future::pending().await;
        };

        tokio::time::sleep_until(kill_at).await;
    }

    /// Sends SIGTERM to the child, unless it was reaped already.
    #[cfg(unix)]
    fn send_sigterm(child: &mut Child) -> io::Result<()> {
        use nix::sys::signal::{Signal, kill};
        use nix::unistd::Pid;

        let Some(pid) = child.id() else {
            return Ok(());
        };

        kill(Pid::from_raw(pid.cast_signed()), Signal::SIGTERM).map_err(io::Error::from)
    }

    /// Kills the child: there is no SIGTERM outside Unix.
    #[cfg(not(unix))]
    fn send_sigterm(child: &mut Child) -> io::Result<()> {
        child.start_kill()
    }
}
