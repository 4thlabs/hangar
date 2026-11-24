//! The reading of a child's pipes.

use std::io;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{ChildStderr, ChildStdout};
use tokio_util::sync::CancellationToken;

use super::Destination;
use crate::runtime::output::Forward;
use crate::runtime::stderr_tail::StderrTail;

/// What a run keeps of one of the child's pipes as it reads it.
#[derive(Debug)]
pub(super) struct Reader {
    forward: Option<Forward>,
    /// stdout, when it is captured.
    captured: Option<Vec<u8>>,
    /// The end of stderr.
    tail: Option<StderrTail>,
}

impl Reader {
    /// The size of a read from a pipe.
    const READ_BYTES: usize = 8 * 1024;

    /// How long a pipe may stay silent once the child exited: a grandchild that holds it open, as `ssh` with
    /// `ControlPersist`, must not hold the run.
    const DRAIN: Duration = Duration::from_secs(1);

    /// The reader of stdout, which goes where `destination` says until `stop` asks the run to stop.
    pub(super) fn stdout(destination: &Destination, stop: &CancellationToken) -> Self {
        match destination {
            Destination::Output(output) => Self {
                forward: Forward::new(output, stop),
                captured: None,
                tail: None,
            },
            Destination::Capture => Self {
                forward: None,
                captured: Some(Vec::new()),
                tail: None,
            },
        }
    }

    /// The reader of stderr, which keeps its end and goes with stdout when it is streamed.
    pub(super) fn stderr(destination: &Destination, stop: &CancellationToken) -> Self {
        let forward = match destination {
            Destination::Output(output) => Forward::new(output, stop),
            Destination::Capture => None,
        };

        Self {
            forward,
            captured: None,
            tail: Some(StderrTail::default()),
        }
    }

    /// Reads both pipes to their end, or until they stay silent for [`Reader::DRAIN`] once `exited` is cancelled.
    pub(super) async fn read_both(
        stdout: &mut Self,
        stdout_pipe: Option<ChildStdout>,
        stderr: &mut Self,
        stderr_pipe: Option<ChildStderr>,
        exited: &CancellationToken,
    ) -> io::Result<()> {
        let (stdout_read, stderr_read) = tokio::join!(
            stdout.read(stdout_pipe, exited),
            stderr.read(stderr_pipe, exited)
        );

        stdout_read.and(stderr_read)
    }

    /// Sends the last line held back, once the reading is over.
    pub(super) async fn finish(&mut self) {
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
            let read = tokio::select! {
                biased;
                read = pipe.read(&mut buffer) => read?,
                () = Self::drained(exited) => return Ok(()),
            };

            if read == 0 {
                return Ok(());
            }

            self.take(&buffer[..read]).await;
        }
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
