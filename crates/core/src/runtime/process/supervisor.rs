//! The task that owns a child: its process, its pipes and its count, and the only one that signals it.

use std::future::{self, Future};
use std::io;
use std::pin::Pin;
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
///
/// A stopped run has one deadline: [`Reader::DRAIN`] after the child is reaped, or after SIGKILL. Until then, the
/// pipes are read and the output waits for its reader; at the deadline, `cut` stops both, and the run is cancelled.
#[derive(Debug)]
pub(super) struct Supervisor {
    pub(super) child: Child,
    pub(super) counted: Counted,
    pub(super) stdout: Reader,
    pub(super) stderr: Reader,
    /// Asks for the child to stop: the run's cancellation, the run dropped, or a pipe that can no longer be read.
    pub(super) stop: CancellationToken,
    /// Cancelled at the deadline of a stopped run, which the readers and their outputs share.
    pub(super) cut: CancellationToken,
    /// How long the child has between SIGTERM and SIGKILL.
    pub(super) grace: Duration,
}

/// What a child left once it exited.
#[derive(Debug)]
pub(super) struct Exit {
    /// Its exit status, or why the supervisor lost track of it.
    pub(super) status: io::Result<ExitStatus>,
    /// How the reading of its pipes ended: at their close, at the silence that follows the exit, or at the cut;
    /// `None` when it did not end, as for a child the supervisor lost track of.
    pub(super) read: Option<io::Result<()>>,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: StderrTail,
    /// Whether it was signaled to stop before it exited; always `false` when `status` is an error.
    pub(super) stopped: bool,
    /// Whether the run reached the deadline of its stop, its output cut.
    pub(super) cut: bool,
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
    /// pipes, which ends at their close, after a silence, or at the deadline of a stop, and reports the exit.
    async fn supervise(self, report: oneshot::Sender<Exit>) {
        let Self {
            mut child,
            counted,
            mut stdout,
            mut stderr,
            stop,
            cut,
            grace,
        } = self;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let exited = CancellationToken::new();
        let mut state = Stop::NotAsked;
        let mut cut_at = None;
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
                () = Self::kill_deadline(state) => match Self::kill(&mut child) {
                    Ok(next) => state = next,
                    Err(error) => break Ending::Lost(error),
                },
                // A killed child that is not reaped by the deadline, as one in uninterruptible sleep.
                () = Self::at(cut_at), if !cut.is_cancelled() => cut.cancel(),
            }

            if state == Stop::Killed && cut_at.is_none() {
                cut_at = Some(Instant::now() + Reader::DRAIN);
            }
        };

        let status = match ending {
            Ending::Exited(status) => status,
            Ending::Lost(error) => {
                // The pipes close, so that the child gets EOF or SIGPIPE rather than block on a pipe nobody reads,
                // and so does the output channel, its last lines sent if its reader takes them in time.
                drop(reading);
                Self::finish_within(&mut stdout, &mut stderr, &cut).await;
                drop((stdout, stderr));

                Self::report(report, Exit::lost(error, read));
                Self::outlive(child, counted).await;

                return;
            }
        };

        // The child is reaped: it no longer holds back a CLI waiting for its children.
        drop(counted);
        exited.cancel();

        if stop.is_cancelled() && cut_at.is_none() {
            cut_at = Some(Instant::now() + Reader::DRAIN);
        }

        let read = match read {
            Some(result) => {
                drop(reading);
                result
            }
            None => Self::drain(reading, &stop, &cut, cut_at).await,
        };

        Self::report(
            report,
            Exit {
                read: Some(read),
                stdout: stdout.into_captured(),
                stderr: stderr.into_tail(),
                stopped: status.is_ok() && state != Stop::NotAsked,
                cut: cut.is_cancelled(),
                status,
            },
        );
    }

    /// Reads what the child left in its pipes and sends the last lines, until the deadline of a stop: `cut_at`, or
    /// [`Reader::DRAIN`] after a stop that comes now.
    async fn drain(
        mut reading: Pin<Box<impl Future<Output = io::Result<()>>>>,
        stop: &CancellationToken,
        cut: &CancellationToken,
        mut cut_at: Option<Instant>,
    ) -> io::Result<()> {
        loop {
            tokio::select! {
                biased;
                result = &mut reading => return result,
                () = stop.cancelled(), if cut_at.is_none() => {
                    cut_at = Some(Instant::now() + Reader::DRAIN);
                }
                () = Self::at(cut_at) => {
                    cut.cancel();

                    // The readers stop at the cut.
                    return reading.await;
                }
            }
        }
    }

    /// Sends the lines the readers held back, for [`Reader::DRAIN`] at most, then cuts what is left.
    async fn finish_within(stdout: &mut Reader, stderr: &mut Reader, cut: &CancellationToken) {
        let finishing = async {
            stdout.finish().await;
            stderr.finish().await;
        };

        tokio::select! {
            () = finishing => {}
            () = tokio::time::sleep(Reader::DRAIN) => cut.cancel(),
        }
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

    /// Resolves when a SIGTERM's grace period is over, and never otherwise.
    async fn kill_deadline(state: Stop) {
        let Stop::Terminated { kill_at } = state else {
            return future::pending().await;
        };

        tokio::time::sleep_until(kill_at).await;
    }

    /// Resolves at `instant`, and never without one.
    async fn at(instant: Option<Instant>) {
        let Some(instant) = instant else {
            return future::pending().await;
        };

        tokio::time::sleep_until(instant).await;
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
    /// The exit of a child the supervisor lost track of, and how the reading of its pipes ended, if it did.
    fn lost(error: io::Error, read: Option<io::Result<()>>) -> Self {
        Self {
            status: Err(error),
            read,
            stdout: Vec::new(),
            stderr: StderrTail::default(),
            stopped: false,
            cut: false,
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
