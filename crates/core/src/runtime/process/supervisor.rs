//! The task that owns a child: its process, its pipes and its count, and the only one that signals it.

use std::error::Error;
use std::fmt;
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
use crate::runtime::output::Outbox;
use crate::runtime::stderr_tail::StderrTail;

/// Follows a child from its start to its exit, in a task of its own, so that a run cancelled and a run dropped stop it
/// the same way: SIGTERM once, then SIGKILL after the grace period.
///
/// From the stop on, the pipes are always read and the output is best effort, so that what the child prints as it
/// stops never blocks it. The reading ends at the latest at the cut: [`Reader::DRAIN`] after the reap, earlier or later
/// than the end of the grace period; [`Reader::DRAIN`] after the end of the grace period, or after SIGKILL, bounds a
/// child that is not reaped.
#[derive(Debug)]
pub(super) struct Supervisor {
    pub(super) child: Child,
    pub(super) counted: Counted,
    pub(super) stdout: Reader,
    pub(super) stderr: Reader,
    /// Where a streamed output goes, which the readers write to.
    pub(super) outbox: Option<Outbox>,
    /// Asks for the child to stop: the run's cancellation, the run dropped, or a pipe that can no longer be read.
    pub(super) stop: CancellationToken,
    /// Cancelled at the cut of a stopped run, which ends the reading of both pipes.
    pub(super) cut: CancellationToken,
    /// How long the child has between SIGTERM and SIGKILL.
    pub(super) grace: Duration,
}

/// What a child left.
#[derive(Debug)]
pub(super) struct Exit {
    pub(super) status: Status,
    /// How the reading of its pipes ended: at their close, at the silence that follows the exit, or at the cut.
    pub(super) read: io::Result<()>,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: StderrTail,
    /// Whether it was signaled to stop.
    pub(super) stopped: bool,
    /// Whether the cut ended the reading, its output incomplete.
    pub(super) cut: bool,
    /// Whether a stopping run dropped output its reader did not take in time: incomplete, as after a cut.
    pub(super) dropped: bool,
}

/// How a child ended, as far as the supervisor knows.
#[derive(Debug)]
pub(super) enum Status {
    /// It exited and was reaped.
    Exited(ExitStatus),
    /// The supervisor could not wait for it or signal it, and it may still run.
    Lost(LostChild),
    /// It was killed but not reaped by the cut, as a child in uninterruptible sleep; it stays counted until it is.
    Unreaped,
}

/// Why the supervisor lost track of a child, with the error the reading of its pipes met, if any, as its source.
#[derive(Debug)]
pub(super) struct LostChild {
    error: io::Error,
    read: Option<io::Error>,
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
    Exited(ExitStatus),
    /// The child could not be waited for or signaled, and may still run.
    Lost(io::Error),
    /// The cut came before the reap of a killed child.
    Unreaped,
}

impl Supervisor {
    /// Spawns the task, which reports the exit on the receiver; the task goes on if the receiver is dropped.
    pub(super) fn start(self) -> oneshot::Receiver<Exit> {
        let (sender, receiver) = oneshot::channel();

        tokio::spawn(self.supervise(sender));

        receiver
    }

    /// Reads the pipes and waits for the child to exit, stopping it when asked; then reads what is left in its
    /// pipes, which ends at their close, after a silence, or at the cut, and reports the exit.
    async fn supervise(self, report: oneshot::Sender<Exit>) {
        let Self {
            mut child,
            counted,
            mut stdout,
            mut stderr,
            outbox,
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

        // Boxed, to be awaited to its end apart from the loop.
        let mut reading = Box::pin(Reader::read_both(
            &mut stdout,
            stdout_pipe,
            &mut stderr,
            stderr_pipe,
            &exited,
            outbox.as_ref(),
        ));

        let ending = loop {
            tokio::select! {
                biased;
                status = child.wait() => match status {
                    Ok(status) => break Ending::Exited(status),
                    Err(error) => break Ending::Lost(error),
                },
                result = reading.as_mut(), if read.is_none() => read = Some(result),
                () = stop.cancelled(), if state == Stop::NotAsked => {
                    match Self::answer_stop(&mut child, grace) {
                        Ok(Answer::Exited(status)) => break Ending::Exited(status),
                        Ok(Answer::Stopping(next)) => {
                            state = next;
                            cut_at = Some(Self::cut_after_signal(next));
                        }
                        Err(error) => break Ending::Lost(error),
                    }
                }
                () = Self::kill_deadline(state) => match Self::kill(&mut child) {
                    Ok(next) => {
                        state = next;

                        // From when SIGKILL was sent: a late timer must not find unreaped a child about to be.
                        cut_at = cut_at.max(Some(Self::cut_from_now()));
                    }
                    Err(error) => break Ending::Lost(error),
                },
                () = Self::at(cut_at) => break Ending::Unreaped,
            }
        };

        let status = match ending {
            Ending::Exited(status) => status,
            Ending::Lost(error) => {
                // It cannot be stopped: its output goes best effort, read until a cut that closes the pipes, so that it
                // gets EOF or SIGPIPE rather than block, and the output channel closes.
                stop.cancel();

                let read = match read {
                    Some(result) => {
                        drop(reading);
                        result
                    }
                    None => Self::drain(reading, &stop, &cut, Some(Self::cut_from_now())).await,
                };

                let lost = Status::Lost(LostChild::new(error, read));
                let exit = Exit::without_output(lost, Ok(()), false);

                Self::abandon(report, exit, (stdout, stderr, outbox), child, counted).await;

                return;
            }
            Ending::Unreaped => {
                cut.cancel();

                // The readers stop at the cut.
                let read = match read {
                    Some(result) => {
                        drop(reading);
                        result
                    }
                    None => reading.await,
                };

                let exit = Exit::without_output(Status::Unreaped, read, true);

                Self::abandon(report, exit, (stdout, stderr, outbox), child, counted).await;

                return;
            }
        };

        // The child is reaped: it no longer holds back a CLI waiting for its children.
        drop(counted);
        exited.cancel();

        // Reaped: the grace period no longer matters, earlier or later.
        if stop.is_cancelled() {
            cut_at = Some(Self::cut_from_now());
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
                status: Status::Exited(status),
                read,
                stdout: stdout.into_captured(),
                stderr: stderr.into_tail(),
                stopped: state != Stop::NotAsked,
                cut: cut.is_cancelled(),
                dropped: outbox.as_ref().is_some_and(Outbox::has_dropped),
            },
        );
    }

    /// Reads what the child left in its pipes and sends the last lines, until the cut: `cut_at`, or
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
                () = stop.cancelled(), if cut_at.is_none() => cut_at = Some(Self::cut_from_now()),
                () = Self::at(cut_at) => {
                    cut.cancel();

                    // The readers stop at the cut.
                    return reading.await;
                }
            }
        }
    }

    /// The cut of a child just signaled: [`Reader::DRAIN`] after the end of its grace period, which a SIGKILL ends
    /// at once.
    fn cut_after_signal(state: Stop) -> Instant {
        let Stop::Terminated { kill_at } = state else {
            return Self::cut_from_now();
        };

        kill_at + Reader::DRAIN
    }

    /// [`Reader::DRAIN`] from now.
    fn cut_from_now() -> Instant {
        Instant::now() + Reader::DRAIN
    }

    /// Hands the exit to the run.
    fn report(report: oneshot::Sender<Exit>, exit: Exit) {
        // A run that went away does not wait for the exit.
        let _ = report.send(exit);
    }

    /// Ends the run of a child the supervisor no longer follows: closes its output, the readers and the outbox, which
    /// holds the sender of the output channel, so that its reader sees the end with the run's rather than with the
    /// child's; reports `exit`; then keeps the child counted until it exits.
    async fn abandon(
        report: oneshot::Sender<Exit>,
        exit: Exit,
        output: (Reader, Reader, Option<Outbox>),
        child: Child,
        counted: Counted,
    ) {
        drop(output);
        Self::report(report, exit);
        Self::outlive(child, counted).await;
    }

    /// Keeps a child that could not be followed to its end counted until it exits on its own.
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
    ///
    /// A child that exits by itself between the `try_wait` of [`answer_stop`](Self::answer_stop) and the SIGTERM is
    /// reported cancelled: its exit code cannot tell it from a child that stopped gracefully on SIGTERM.
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
    /// The exit of a child that was not followed to its reap, whose output does not count: lost, or killed and not
    /// reaped by the cut.
    fn without_output(status: Status, read: io::Result<()>, stopped: bool) -> Self {
        Self {
            status,
            read,
            stdout: Vec::new(),
            stderr: StderrTail::default(),
            stopped,
            cut: true,
            dropped: false,
        }
    }
}

impl LostChild {
    /// The supervisor's `error`, with how the reading of the pipes ended.
    pub(super) fn new(error: io::Error, read: io::Result<()>) -> Self {
        Self {
            error,
            read: read.err(),
        }
    }

    /// The kind of the supervisor's error.
    pub(super) fn kind(&self) -> io::ErrorKind {
        self.error.kind()
    }
}

impl fmt::Display for LostChild {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "lost track of the child: {}", self.error)
    }
}

impl Error for LostChild {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.read
            .as_ref()
            .map(|error| error as &(dyn Error + 'static))
    }
}

// `waitid`, which sees an exit without reaping the child, is not in nix on every Unix, as macOS.
#[cfg(all(test, any(target_os = "linux", target_os = "android")))]
mod tests {
    use std::time::Duration;

    use std::sync::Arc;

    use nix::sys::signal::{Signal, kill};
    use nix::sys::wait::{Id, WaitPidFlag, waitid};
    use nix::unistd::Pid;
    use tokio::sync::{mpsc, oneshot};
    use tokio_util::sync::CancellationToken;

    use super::super::Destination;
    use super::super::children::Children;
    use super::{Answer, Exit, Status, Supervisor};
    use crate::Output;
    use crate::runtime::output::Outbox;
    use crate::runtime::process::reader::Reader;

    #[tokio::test]
    async fn an_abandoned_child_closes_the_output_channel_before_it_exits() {
        let deadline = Duration::from_secs(10);
        let mut child = tokio::process::Command::new("sleep")
            .arg("60")
            .kill_on_drop(true)
            .spawn()
            .expect("sleep starts");
        let pid = Pid::from_raw(child.id().expect("running").cast_signed());
        let children = Arc::new(Children::new());
        let counted = children.enter().expect("not interrupted");
        let (sender, mut receiver) = mpsc::channel(1);
        let nothing = CancellationToken::new();
        let outbox = Outbox::new(&Output::Lines(sender), &nothing, &nothing);
        let stdout = Reader::stdout(&Destination::Capture, outbox.as_ref(), &nothing, &nothing);
        let stderr = Reader::stderr(outbox.as_ref(), &nothing, &nothing);
        let (report, exit) = oneshot::channel();

        drop(child.stdout.take());

        let abandoning = tokio::spawn(Supervisor::abandon(
            report,
            Exit::without_output(Status::Unreaped, Ok(()), true),
            (stdout, stderr, outbox),
            child,
            counted,
        ));

        let end = tokio::time::timeout(deadline, receiver.recv())
            .await
            .expect("the output channel closes with the run");
        let exit = exit.await.expect("the run is reported");

        assert!(end.is_none());
        assert!(matches!(exit.status, Status::Unreaped));
        assert!(kill(pid, None).is_ok(), "the child still runs");

        kill(pid, Signal::SIGKILL).expect("the child can be killed");
        tokio::time::timeout(deadline, children.idle())
            .await
            .expect("the child is counted until it is reaped");
        abandoning.await.expect("the task does not panic");
    }

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
