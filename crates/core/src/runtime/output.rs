//! Where the output of a run goes, and how it is cut on the way.

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Where a run sends its stdout and stderr. A captured run keeps stdout alone instead, through
/// [`CommandRunner::capture`](crate::CommandRunner::capture).
///
/// A streamed output goes to a bounded channel, which a compose batch shares between its runs and an HTTP stream
/// reads. A full channel pauses the run until the reader catches up, so that a slow reader holds the child back
/// rather than growing memory with the whole output, even after the child exited: a reader that stops reading without
/// dropping its receiver holds the run until it is cancelled. A reader that has gone away loses the rest, and the
/// command goes on without it.
///
/// A cancelled run has one deadline, as [`Runtime`](crate::Runtime) says: until then nothing is cut, and every
/// message waits for the reader, a stalled one included; at the deadline, what is left is dropped, the last line held
/// back included. A reader that keeps up loses nothing written before the deadline.
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
    sender: mpsc::Sender<Vec<u8>>,
    /// Cancelled at the deadline of a stopped run, for both streams at once: what is left is dropped.
    cut: CancellationToken,
    /// The start of a line still to end, for [`Output::Lines`]; `None` sends chunks as they come.
    pending_line: Option<Vec<u8>>,
}

impl Forward {
    /// How long a line may grow before it is sent in pieces: a child printing no newline must not grow memory.
    const MAX_LINE_BYTES: usize = 64 * 1024;

    /// A forward for one stream of a run, which drops what is left once `cut` is cancelled, or `None` when the output
    /// is not streamed.
    pub(crate) fn new(output: &Output, cut: &CancellationToken) -> Option<Self> {
        let (sender, pending_line) = match output {
            Output::Inherit => return None,
            Output::Lines(sender) => (sender, Some(Vec::new())),
            Output::Chunks(sender) => (sender, None),
        };

        Some(Self {
            sender: sender.clone(),
            cut: cut.clone(),
            pending_line,
        })
    }

    /// Sends what the child wrote, or keeps the start of a line until its end comes.
    pub(crate) async fn write(&mut self, chunk: &[u8]) {
        let Some(pending) = &mut self.pending_line else {
            Self::send(&self.sender, &self.cut, chunk.to_vec()).await;
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
                    Self::send(&self.sender, &self.cut, std::mem::take(pending)).await;
                }
            }
        }
    }

    /// Sends the last line, which the child did not end with a newline, unless the run was cut.
    pub(crate) async fn finish(&mut self) {
        let Some(pending) = &mut self.pending_line else {
            return;
        };

        if !pending.is_empty() {
            Self::send(&self.sender, &self.cut, std::mem::take(pending)).await;
        }
    }

    /// Sends one message, waiting while the channel is full, until the run is cut.
    async fn send(sender: &mpsc::Sender<Vec<u8>>, cut: &CancellationToken, output: Vec<u8>) {
        if cut.is_cancelled() {
            return;
        }

        tokio::select! {
            biased;
            // A reader that has gone away, as a closed page, loses the rest: the command goes on without it.
            _ = sender.send(output) => {}
            () = cut.cancelled() => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;

    use super::{Forward, Output};

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

    #[tokio::test]
    async fn waits_for_a_stalled_reader_until_the_cut_then_drops_the_rest() {
        let (sender, receiver) = mpsc::channel(1);
        let cut = CancellationToken::new();
        let mut forward = Forward::new(&Output::Lines(sender), &cut).expect("lines are streamed");

        // Nobody reads: the second line waits until the cut.
        let cutting = async {
            tokio::task::yield_now().await;
            cut.cancel();
        };

        tokio::join!(forward.write(b"one\ntwo\n"), cutting);

        forward.write(b"three\nheld").await;
        forward.finish().await;

        assert_eq!(received(receiver), [b"one\n".to_vec()]);
    }

    #[test]
    fn an_inherited_output_has_nothing_to_forward() {
        assert!(Forward::new(&Output::Inherit, &CancellationToken::new()).is_none());
    }
}
