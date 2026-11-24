//! The reading of a child's pipes.

use std::io;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{ChildStderr, ChildStdout};
use tokio_util::sync::CancellationToken;

use super::Destination;
use crate::runtime::output::{Forward, Outbox};
use crate::runtime::stderr_tail::StderrTail;

/// What a run keeps of one of the child's pipes as it reads it.
#[derive(Debug)]
pub(super) struct Reader {
    forward: Option<Forward>,
    /// Asks the child to stop, when its pipe can no longer be read.
    stop: CancellationToken,
    /// Cancelled at the cut of a stopped run: the pipe is no longer read.
    cut: CancellationToken,
    /// stdout, when it is captured.
    captured: Option<Vec<u8>>,
    /// The end of stderr.
    tail: Option<StderrTail>,
}

impl Reader {
    /// The size of a read from a pipe.
    const READ_BYTES: usize = 8 * 1024;

    /// How long a pipe may stay silent once the child exited: a grandchild that holds it open, as `ssh` with
    /// `ControlPersist`, must not hold the run. It is also how long a stopped run reads after its child is gone.
    pub(super) const DRAIN: Duration = Duration::from_secs(1);

    /// The reader of stdout, which keeps it when `destination` captures it and sends it to `outbox` when it is
    /// streamed. It asks for `stop` when its pipe fails, which makes the output best effort as a cancel does, and it
    /// stops reading at the `cut` of a stopped run.
    pub(super) fn stdout(
        destination: &Destination,
        outbox: Option<&Outbox>,
        stop: &CancellationToken,
        cut: &CancellationToken,
    ) -> Self {
        Self {
            forward: outbox.map(Outbox::forward),
            stop: stop.clone(),
            cut: cut.clone(),
            captured: matches!(destination, Destination::Capture).then(Vec::new),
            tail: None,
        }
    }

    /// The reader of stderr, which keeps its end and goes to `outbox` with stdout when it is streamed, as
    /// [`stdout`](Self::stdout) says.
    pub(super) fn stderr(
        outbox: Option<&Outbox>,
        stop: &CancellationToken,
        cut: &CancellationToken,
    ) -> Self {
        Self {
            forward: outbox.map(Outbox::forward),
            stop: stop.clone(),
            cut: cut.clone(),
            captured: None,
            tail: Some(StderrTail::default()),
        }
    }

    /// Reads both pipes to their end, until they stay silent for [`Reader::DRAIN`] once `exited` is cancelled, or
    /// until the run is cut; then sends the lines held back, while `outbox` feeds the channel to its end, or to the
    /// cut.
    pub(super) async fn read_both(
        stdout: &mut Self,
        stdout_pipe: Option<ChildStdout>,
        stderr: &mut Self,
        stderr_pipe: Option<ChildStderr>,
        exited: &CancellationToken,
        outbox: Option<&Outbox>,
    ) -> io::Result<()> {
        let reading = async {
            let (stdout_read, stderr_read) = tokio::join!(
                stdout.read(stdout_pipe, exited),
                stderr.read(stderr_pipe, exited)
            );

            stdout.finish().await;
            stderr.finish().await;

            stdout_read.and(stderr_read)
        };
        let flushing = async {
            if let Some(outbox) = outbox {
                outbox.flush().await;
            }
        };

        let (read, ()) = tokio::join!(reading, flushing);

        read
    }

    /// Sends the last line held back, once the reading is over, and ends the stream.
    async fn finish(&mut self) {
        if let Some(forward) = &mut self.forward {
            forward.finish().await;
        }
    }

    /// The captured stdout, empty when it was not captured.
    pub(super) fn into_captured(self) -> Vec<u8> {
        self.captured.unwrap_or_default()
    }

    /// The end of stderr, empty when it was inherited.
    pub(super) fn into_tail(self) -> StderrTail {
        self.tail.unwrap_or_default()
    }

    /// Reads `pipe` to its end; an inherited stream has no pipe.
    async fn read(
        &mut self,
        pipe: Option<impl AsyncRead + Unpin>,
        exited: &CancellationToken,
    ) -> io::Result<()> {
        let Some(mut pipe) = pipe else {
            return Ok(());
        };

        let mut buffer = vec![0; Self::READ_BYTES];

        loop {
            // The cut first: a pipe that never stops writing must not hold it back.
            let read = tokio::select! {
                biased;
                () = self.cut.cancelled() => return Ok(()),
                read = pipe.read(&mut buffer) => read,
                () = Self::drained(exited) => return Ok(()),
            };

            let read = match read {
                Ok(read) => read,
                Err(error) => return self.fail(error, pipe, exited).await,
            };

            if read == 0 {
                return Ok(());
            }

            self.take(&buffer[..read]).await;
        }
    }

    /// Stops the child, whose output can no longer be read, and holds `pipe` open until it exits, so that its next
    /// write does not kill it with SIGPIPE before SIGTERM reaches it.
    async fn fail(
        &self,
        error: io::Error,
        pipe: impl AsyncRead + Unpin,
        exited: &CancellationToken,
    ) -> io::Result<()> {
        self.stop.cancel();

        tokio::select! {
            () = exited.cancelled() => {}
            () = self.cut.cancelled() => {}
        }

        drop(pipe);

        Err(error)
    }

    /// Keeps and sends what the child wrote.
    async fn take(&mut self, chunk: &[u8]) {
        if let Some(captured) = &mut self.captured {
            captured.extend_from_slice(chunk);
        }

        if let Some(tail) = &mut self.tail {
            tail.write(chunk);
        }

        if let Some(forward) = &mut self.forward {
            forward.write(chunk).await;
        }
    }

    /// Resolves [`Reader::DRAIN`] after the child exited.
    async fn drained(exited: &CancellationToken) {
        exited.cancelled().await;
        tokio::time::sleep(Self::DRAIN).await;
    }
}
