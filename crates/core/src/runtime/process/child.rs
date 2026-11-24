//! A child of the runtime: counted while it runs, and stopped gracefully when its run is cancelled or dropped.

use std::future::{self, Future};
use std::io;
use std::pin::{Pin, pin};
use std::process::ExitStatus;
use std::sync::Arc;
use std::time::Duration;

use tokio::process::Child;
use tokio::runtime::Handle;
use tokio::sync::watch;

/// How many children a runtime has running, its clones included.
#[derive(Debug)]
pub(super) struct ChildCount {
    running: watch::Sender<usize>,
}

impl ChildCount {
    /// A count with no child yet.
    pub(super) fn new() -> Self {
        Self {
            running: watch::Sender::new(0),
        }
    }

    /// Resolves once no child is running.
    pub(super) async fn idle(&self) {
        self.running
            .subscribe()
            .wait_for(|running| *running == 0)
            .await
            .expect("the count holds its sender while it is borrowed");
    }
}

/// One child in a [`ChildCount`], until it is dropped.
#[derive(Debug)]
struct Counted(Arc<ChildCount>);

impl Counted {
    fn new(count: &Arc<ChildCount>) -> Self {
        count.running.send_modify(|running| *running += 1);

        Self(Arc::clone(count))
    }
}

impl Drop for Counted {
    fn drop(&mut self) {
        self.0.running.send_modify(|running| *running -= 1);
    }
}

/// A running child. Dropped before it exits, as when its run is dropped, it gets SIGTERM, then SIGKILL after the grace
/// period, and stays counted until then.
#[derive(Debug)]
pub(super) struct RunningChild {
    /// Always there; only `drop` takes it.
    child: Option<Child>,
    counted: Option<Counted>,
    grace: Duration,
}

impl RunningChild {
    /// Counts `child` in `count` until it is gone.
    pub(super) fn new(child: Child, count: &Arc<ChildCount>, grace: Duration) -> Self {
        Self {
            child: Some(child),
            counted: Some(Counted::new(count)),
            grace,
        }
    }

    /// The child process.
    pub(super) fn child(&mut self) -> &mut Child {
        self.child.as_mut().expect("only drop takes the child")
    }

    /// Waits for the child to exit while `reading` reads its pipes, so that it never blocks on a full one; `None` when
    /// `until` resolves first.
    pub(super) async fn wait_reading(
        child: &mut Child,
        mut reading: Pin<&mut impl Future<Output = io::Result<()>>>,
        read: &mut Option<io::Result<()>>,
        until: impl Future<Output = ()>,
    ) -> Option<io::Result<ExitStatus>> {
        let mut until = pin!(until);

        loop {
            tokio::select! {
                biased;
                status = child.wait() => return Some(status),
                result = reading.as_mut(), if read.is_none() => *read = Some(result),
                () = &mut until => return None,
            }
        }
    }

    /// Stops the child, reading its pipes meanwhile: see [`RunningChild::stop_child`].
    pub(super) async fn stop(
        &mut self,
        reading: Pin<&mut impl Future<Output = io::Result<()>>>,
        read: &mut Option<io::Result<()>>,
    ) -> io::Result<()> {
        let grace = self.grace;

        Self::stop_child(self.child(), grace, reading, read).await
    }

    /// Sends SIGTERM, which lets the child stop what it runs, as `docker compose` its plugin, then SIGKILL after
    /// `grace`, and waits for it to exit.
    async fn stop_child(
        child: &mut Child,
        grace: Duration,
        reading: Pin<&mut impl Future<Output = io::Result<()>>>,
        read: &mut Option<io::Result<()>>,
    ) -> io::Result<()> {
        if let Err(error) = Self::terminate(child) {
            tracing::warn!(%error, "could not send SIGTERM to a child, killing it");

            return child.kill().await;
        }

        match Self::wait_reading(child, reading, read, tokio::time::sleep(grace)).await {
            Some(status) => status.map(drop),
            None => child.kill().await,
        }
    }

    /// Sends SIGTERM to the child, unless it was reaped already.
    #[cfg(unix)]
    fn terminate(child: &mut Child) -> io::Result<()> {
        use nix::sys::signal::{Signal, kill};
        use nix::unistd::Pid;

        let Some(pid) = child.id() else {
            return Ok(());
        };

        kill(Pid::from_raw(pid.cast_signed()), Signal::SIGTERM).map_err(io::Error::from)
    }

    /// Kills the child: there is no SIGTERM outside Unix.
    #[cfg(not(unix))]
    fn terminate(child: &mut Child) -> io::Result<()> {
        child.start_kill()
    }
}

impl Drop for RunningChild {
    fn drop(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };

        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }

        // With no runtime left to wait in, dropping the child kills it at once, through `kill_on_drop`.
        let Ok(runtime) = Handle::try_current() else {
            return;
        };

        let counted = self.counted.take();
        let grace = self.grace;

        runtime.spawn(async move {
            let mut read = None;
            let no_reading = pin!(future::pending());

            if let Err(error) = Self::stop_child(&mut child, grace, no_reading, &mut read).await {
                tracing::warn!(%error, "could not stop a child whose run was dropped");
            }

            drop(counted);
        });
    }
}
