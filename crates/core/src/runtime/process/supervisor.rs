//! The task that owns a child: its process, its pipes and its count, and the only one that signals it.

use std::future;
use std::io;
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
    /// Asks for the child to stop: the run's cancellation, the run dropped, or a pipe that can no longer be read.
    pub(super) stop: CancellationToken,
    /// How long the child has between SIGTERM and SIGKILL.
    pub(super) grace: Duration,
}

/// What a child left once it exited.
#[derive(Debug)]
pub(super) struct Exit {
    /// Its exit status, or why the supervisor lost track of it.
    pub(super) status: io::Result<ExitStatus>,
    /// Whether its pipes were read to their end, or to the silence that follows its exit.
    pub(super) read: io::Result<()>,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: StderrTail,
    /// Whether it was signaled to stop before it exited, which makes the run cancelled; always `false` when `status`
    /// is an error.
    pub(super) stopped: bool,
}

/// Where the stop of a child is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    /// Nobody asked for it.
    NotAsked,
    /// SIGTERM was sent; SIGKILL follows at the deadline.
    #[cfg_attr(
        not(unix),
        expect(dead_code, reason = "there is no SIGTERM outside Unix")
    )]
    Terminated { kill_at: Instant },
    /// SIGKILL was sent.
    Killed,
}

/// What a stop does to a child.
#[derive(Debug)]
enum Answer {
    /// Nothing: the child had exited, though tokio had not reaped it yet.
    Exited(ExitStatus),
    /// It was signaled.
    Stopping(Stop),
}

/// How the following of a child ends.
#[derive(Debug)]
enum Ending {
    /// The child exited and was reaped.
    Exited(io::Result<ExitStatus>),
    /// The child could not be signaled, and may still run.
    Lost(io::Error),
}

impl Supervisor {
    /// Spawns the task, which reports the exit on the receiver; the task goes on if the receiver is dropped.
    pub(super) fn start(self) -> oneshot::Receiver<Exit> {
        let (sender, receiver) = oneshot::channel();

        tokio::spawn(self.supervise(sender));

        receiver
    }

    /// Reads the pipes and waits for the child to exit, stopping it when asked; then reads what is left in its
    /// pipes, which ends at their close or after a silence, and reports the exit.
    async fn supervise(self, report: oneshot::Sender<Exit>) {
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

        // Boxed, to be dropped before the readers are finished.
        let mut reading = Box::pin(Reader::read_both(
            &mut stdout,
            stdout_pipe,
            &mut stderr,
            stderr_pipe,
            &exited,
        ));

        let ending = loop {
            tokio::select! {
                biased;
                status = child.wait() => break Ending::Exited(status),
                result = reading.as_mut(), if read.is_none() => read = Some(result),
                () = stop.cancelled(), if state == Stop::NotAsked => {
                    match Self::answer_stop(&mut child, grace) {
                        Ok(Answer::Exited(status)) => break Ending::Exited(Ok(status)),
                        Ok(Answer::Stopping(next)) => state = next,
                        Err(error) => break Ending::Lost(error),
                    }
                }
                () = Self::deadline(state) => match Self::kill(&mut child) {
                    Ok(next) => state = next,
                    Err(error) => break Ending::Lost(error),
                },
            }
        };

        let status = match ending {
            Ending::Exited(status) => status,
            Ending::Lost(error) => {
                // The pipes close, so that the child gets EOF or SIGPIPE rather than block on a pipe nobody reads,
                // and so does the output channel, so that its reader is not left waiting for its end.
                drop(reading);
                stdout.finish().await;
                stderr.finish().await;
                drop((stdout, stderr));

                Self::report(report, Exit::lost(error, read.unwrap_or(Ok(()))));
                Self::outlive(child, counted).await;

                return;
            }
        };

        // The child is reaped: it no longer holds back a CLI waiting for its children.
        drop(counted);
        exited.cancel();

        let read = match read {
            Some(result) => {
                drop(reading);
                result
            }
            None => reading.await,
        };

        stdout.finish().await;
        stderr.finish().await;

        Self::report(
            report,
            Exit {
                read,
                stdout: stdout.into_captured(),
                stderr: stderr.into_tail(),
                stopped: status.is_ok() && state != Stop::NotAsked,
                status,
            },
        );
    }

    /// Hands the exit to the run.
    fn report(report: oneshot::Sender<Exit>, exit: Exit) {
        // A run that went away does not wait for the exit.
        let _ = report.send(exit);
    }

    /// Keeps a child that could not be signaled counted until it exits on its own.
    async fn outlive(mut child: Child, counted: Counted) {
        if let Err(error) = child.wait().await {
            tracing::warn!(%error, "lost track of a child that could not be stopped");
        }

        drop(counted);
    }

    /// Answers a stop: a child that exited already, though tokio has not reaped it yet, keeps its status, which the
    /// stop no longer concerns; any other is signaled.
    fn answer_stop(child: &mut Child, grace: Duration) -> io::Result<Answer> {
        if let Some(status) = child.try_wait()? {
            return Ok(Answer::Exited(status));
        }

        Self::terminate(child, grace).map(Answer::Stopping)
    }

    /// Sends SIGTERM, which lets the child stop what it runs, as `docker compose` its plugin; SIGKILL at once when it
    /// cannot be sent.
    #[cfg(unix)]
    fn terminate(child: &mut Child, grace: Duration) -> io::Result<Stop> {
        let Err(error) = Self::send_sigterm(child) else {
            return Ok(Stop::Terminated {
                kill_at: Instant::now() + grace,
            });
        };

        tracing::warn!(%error, "could not send SIGTERM to a child, killing it");

        Self::kill(child)
    }

    /// Kills the child: there is no SIGTERM outside Unix.
    #[cfg(not(unix))]
    fn terminate(child: &mut Child, _grace: Duration) -> io::Result<Stop> {
        Self::kill(child)
    }

    /// Sends SIGKILL.
    fn kill(child: &mut Child) -> io::Result<Stop> {
        child.start_kill()?;

        Ok(Stop::Killed)
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
}

impl Exit {
    /// The exit of a child the supervisor lost track of, and how the reading of its pipes went until then.
    fn lost(error: io::Error, read: io::Result<()>) -> Self {
        Self {
            status: Err(error),
            read,
            stdout: Vec::new(),
            stderr: StderrTail::default(),
            stopped: false,
        }
    }
}

// `waitid`, which sees an exit without reaping the child, is not in nix on every Unix, as macOS.
#[cfg(all(test, any(target_os = "linux", target_os = "android")))]
mod tests {
    use std::time::Duration;

    use nix::sys::signal::kill;
    use nix::sys::wait::{Id, WaitPidFlag, waitid};
    use nix::unistd::Pid;

    use super::{Answer, Supervisor};

    #[tokio::test]
    async fn a_stop_after_the_exit_keeps_the_exit_status() {
        let mut child = tokio::process::Command::new("sh")
            .args(["-c", "exit 3"])
            .spawn()
            .expect("sh starts");
        let pid = Pid::from_raw(child.id().expect("not reaped yet").cast_signed());

        // Waits for the exit without reaping the child, which tokio has not done yet either.
        tokio::task::spawn_blocking(move || {
            waitid(Id::Pid(pid), WaitPidFlag::WEXITED | WaitPidFlag::WNOWAIT)
        })
        .await
        .expect("the wait does not panic")
        .expect("the child exits");

        // A SIGTERM would reach the zombie: signaling it is no proof that it runs.
        assert!(kill(pid, None).is_ok());

        let answer = Supervisor::answer_stop(&mut child, Duration::from_secs(10))
            .expect("the child can be checked");

        assert!(matches!(answer, Answer::Exited(status) if status.code() == Some(3)));
    }
}
