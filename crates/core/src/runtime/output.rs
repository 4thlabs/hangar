//! Where the output of a run goes, and how it is cut on the way.

use std::time::Duration;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Where a run sends its stdout and stderr. A captured run keeps stdout alone instead, through
/// [`CommandRunner::capture`](crate::CommandRunner::capture).
///
/// A streamed output goes to a bounded channel, which a compose batch shares between its runs and an HTTP stream
/// reads. A full channel pauses the run until the reader catches up, so that a slow reader holds the child back
/// rather than growing memory with the whole output, even after the child exited: a reader that stops reading without
/// dropping its receiver holds the run until it is cancelled. Once the run is cancelled, a message that waits more
/// than a second for the reader is dropped with the rest, so that a stalled reader does not hold the stop back, and a
/// reader that keeps reading loses nothing. A reader that has gone away loses the rest, and the command goes on
/// without it.
///
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), hangar_core::RunError> {
/// use hangar_core::{Command, CommandRunner, Output, Runtime};
/// use tokio::sync::mpsc;
///
/// let (sender, mut receiver) = mpsc::channel::<Vec<u8>>(64);
/// let reader = tokio::spawn(async move {
///     let mut lines = Vec::new();
///
///     while let Some(line) = receiver.recv().await {
///         lines.push(String::from_utf8_lossy(&line).into_owned());
///     }
///
///     lines
/// });
///
/// let command = Command::new("sh").args(["-c", "echo pulled; echo started"]);
///
/// Runtime::new().run(&command, Output::Lines(sender)).await?;
///
/// assert_eq!(reader.await.expect("the reader does not panic"), ["pulled\n", "started\n"]);
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone)]
pub enum Output {
    /// The child writes to this process's own stdout and stderr, a terminal's in the CLI. Its stderr then does not
    /// reach the error of a failed run.
    Inherit,

    /// stdout and stderr go together to the channel, one line per message, with its newline. A line of more than
    /// 64 KiB comes in pieces, and the last one lacks its newline when the output does not end with one.
    Lines(mpsc::Sender<Vec<u8>>),

    /// stdout and stderr go together to the channel, a chunk per message, as the child writes them.
    Chunks(mpsc::Sender<Vec<u8>>),
}

/// Sends one stream of a child, its stdout or its stderr, to a channel, cut as its [`Output`] says.
#[derive(Debug)]
pub(crate) struct Forward {
    channel: Channel,
    /// The start of a line still to end, for [`Output::Lines`]; `None` sends chunks as they come.
    pending_line: Option<Vec<u8>>,
}

/// The channel a [`Forward`] sends to, and whether it gave up on a stalled reader.
#[derive(Debug)]
struct Channel {
    sender: mpsc::Sender<Vec<u8>>,
    /// Cancelled once the run is asked to stop: a reader that stalls then loses the rest.
    stop: CancellationToken,
    /// Whether a send waited past [`Channel::MAX_STALL`] after the stop, which drops the rest.
    is_abandoned: bool,
}

impl Forward {
    /// How long a line may grow before it is sent in pieces: a child printing no newline must not grow memory.
    const MAX_LINE_BYTES: usize = 64 * 1024;

    /// A forward for one stream of a run, which gives up on a stalled reader once `stop` is cancelled, or `None` when
    /// the output is not streamed.
    pub(crate) fn new(output: &Output, stop: &CancellationToken) -> Option<Self> {
        let (sender, pending_line) = match output {
            Output::Inherit => return None,
            Output::Lines(sender) => (sender, Some(Vec::new())),
            Output::Chunks(sender) => (sender, None),
        };

        Some(Self {
            channel: Channel {
                sender: sender.clone(),
                stop: stop.clone(),
                is_abandoned: false,
            },
            pending_line,
        })
    }

    /// Sends what the child wrote, or keeps the start of a line until its end comes.
    pub(crate) async fn write(&mut self, chunk: &[u8]) {
        let Some(pending) = &mut self.pending_line else {
            self.channel.send(chunk.to_vec()).await;
            return;
        };

        for piece in chunk.split_inclusive(|byte| *byte == b'\n') {
            let mut rest = piece;

            while !rest.is_empty() {
                let room = Self::MAX_LINE_BYTES - pending.len();
                let (head, tail) = rest.split_at(rest.len().min(room));

                pending.extend_from_slice(head);
                rest = tail;

                if pending.ends_with(b"\n") || pending.len() == Self::MAX_LINE_BYTES {
                    self.channel.send(std::mem::take(pending)).await;
                }
            }
        }
    }

    /// Sends the last line, which the child did not end with a newline.
    pub(crate) async fn finish(&mut self) {
        let Some(pending) = &mut self.pending_line else {
            return;
        };

        if !pending.is_empty() {
            self.channel.send(std::mem::take(pending)).await;
        }
    }
}

impl Channel {
    /// How long a send may wait for the reader once the run is asked to stop.
    const MAX_STALL: Duration = Duration::from_secs(1);

    /// Sends one message, waiting while the channel is full; once the run is asked to stop, a send that waits past
    /// [`Channel::MAX_STALL`] drops its message and the rest, so that a stalled reader does not hold the stop.
    async fn send(&mut self, output: Vec<u8>) {
        if self.is_abandoned {
            return;
        }

        tokio::select! {
            biased;
            // A reader that has gone away, as a closed page, loses the rest: the command goes on without it.
            _ = self.sender.send(output) => {}
            () = Self::stalled(&self.stop) => self.is_abandoned = true,
        }
    }

    /// Resolves [`Channel::MAX_STALL`] after the stop, or after the call when the stop came before.
    async fn stalled(stop: &CancellationToken) {
        stop.cancelled().await;
        tokio::time::sleep(Self::MAX_STALL).await;
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;

    use super::{Channel, Forward, Output};

    /// What the channel received, each message apart.
    fn received(mut receiver: mpsc::Receiver<Vec<u8>>) -> Vec<Vec<u8>> {
        let mut messages = Vec::new();

        while let Ok(message) = receiver.try_recv() {
            messages.push(message);
        }

        messages
    }

    #[tokio::test]
    async fn sends_whole_lines_whatever_the_chunks() {
        let (sender, receiver) = mpsc::channel(16);
        let mut forward = Forward::new(&Output::Lines(sender), &CancellationToken::new())
            .expect("lines are streamed");

        forward.write(b"Pulling web\nPull").await;
        forward.write(b"ing db").await;
        forward.write(b"\nDone\nwith no newline").await;
        forward.finish().await;

        assert_eq!(
            received(receiver),
            [
                b"Pulling web\n".to_vec(),
                b"Pulling db\n".to_vec(),
                b"Done\n".to_vec(),
                b"with no newline".to_vec(),
            ]
        );
    }

    #[tokio::test]
    async fn cuts_a_line_that_never_ends() {
        let (sender, receiver) = mpsc::channel(16);
        let mut forward = Forward::new(&Output::Lines(sender), &CancellationToken::new())
            .expect("lines are streamed");

        forward
            .write(&vec![b'.'; Forward::MAX_LINE_BYTES + 10])
            .await;
        forward.finish().await;

        let lengths: Vec<usize> = received(receiver).iter().map(Vec::len).collect();

        assert_eq!(lengths, [Forward::MAX_LINE_BYTES, 10]);
    }

    #[tokio::test]
    async fn sends_chunks_as_they_come() {
        let (sender, receiver) = mpsc::channel(16);
        let mut forward = Forward::new(&Output::Chunks(sender), &CancellationToken::new())
            .expect("chunks are streamed");

        forward.write(b"Pull").await;
        forward.write(b"ing\n").await;
        forward.finish().await;

        assert_eq!(received(receiver), [b"Pull".to_vec(), b"ing\n".to_vec()]);
    }

    #[tokio::test]
    async fn goes_on_once_the_reader_is_gone() {
        let (sender, receiver) = mpsc::channel(1);
        let mut forward = Forward::new(&Output::Lines(sender), &CancellationToken::new())
            .expect("lines are streamed");

        drop(receiver);

        // More lines than the channel holds: a full channel would wait, a closed one does not.
        forward.write(b"one\ntwo\nthree\n").await;
        forward.finish().await;
    }

    #[tokio::test(start_paused = true)]
    async fn drops_the_rest_once_a_send_stalls_past_the_bound_after_the_stop() {
        let (sender, mut receiver) = mpsc::channel(1);
        let stop = CancellationToken::new();
        let mut forward = Forward::new(&Output::Lines(sender), &stop).expect("lines are streamed");

        stop.cancel();

        // Nobody reads: the second line waits for the bound, the third is dropped at once.
        let started = tokio::time::Instant::now();

        forward.write(b"one\ntwo\n").await;

        assert_eq!(started.elapsed(), Channel::MAX_STALL);

        forward.write(b"three\n").await;
        forward.finish().await;

        assert_eq!(started.elapsed(), Channel::MAX_STALL);
        assert_eq!(receiver.recv().await.expect("the first line"), b"one\n");
        assert!(receiver.try_recv().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn loses_nothing_after_the_stop_while_the_reader_takes_the_messages() {
        let (sender, mut receiver) = mpsc::channel(1);
        let stop = CancellationToken::new();
        let mut forward = Forward::new(&Output::Lines(sender), &stop).expect("lines are streamed");

        stop.cancel();

        // Slower than the channel, faster than the bound.
        let reader = tokio::spawn(async move {
            let mut lines = Vec::new();

            while let Some(line) = receiver.recv().await {
                lines.push(line);
                tokio::time::sleep(Channel::MAX_STALL / 2).await;
            }

            lines
        });

        forward.write(b"one\ntwo\nthree\nfour\n").await;
        drop(forward);

        assert_eq!(
            reader.await.expect("the reader does not panic"),
            [
                b"one\n".to_vec(),
                b"two\n".to_vec(),
                b"three\n".to_vec(),
                b"four\n".to_vec()
            ]
        );
    }

    #[test]
    fn an_inherited_output_has_nothing_to_forward() {
        assert!(Forward::new(&Output::Inherit, &CancellationToken::new()).is_none());
    }
}
