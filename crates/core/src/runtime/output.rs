//! Where the output of a run goes, and how it is cut on the way.

use tokio::sync::mpsc;

/// Where a run sends its stdout and stderr. A captured run keeps stdout alone instead, through
/// [`CommandRunner::capture`](crate::CommandRunner::capture).
///
/// A streamed output goes to a bounded channel, which a compose batch shares between its runs and an HTTP stream
/// reads. A full channel pauses the run until the reader catches up, so that a slow reader holds the child back
/// rather than growing memory with the whole output; a reader that has gone away loses the rest, and the command goes
/// on without it.
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
    /// The start of a line still to end, for [`Output::Lines`]; `None` sends chunks as they come.
    pending_line: Option<Vec<u8>>,
}

impl Forward {
    /// How long a line may grow before it is sent in pieces: a child printing no newline must not grow memory.
    const MAX_LINE_BYTES: usize = 64 * 1024;

    /// A forward for one stream of a run, or `None` when the output is not streamed.
    pub(crate) fn new(output: &Output) -> Option<Self> {
        match output {
            Output::Inherit => None,
            Output::Lines(sender) => Some(Self {
                sender: sender.clone(),
                pending_line: Some(Vec::new()),
            }),
            Output::Chunks(sender) => Some(Self {
                sender: sender.clone(),
                pending_line: None,
            }),
        }
    }

    /// Sends what the child wrote, or keeps the start of a line until its end comes.
    pub(crate) async fn write(&mut self, chunk: &[u8]) {
        let Some(pending) = &mut self.pending_line else {
            Self::send(&self.sender, chunk.to_vec()).await;
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
                    Self::send(&self.sender, std::mem::take(pending)).await;
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
            Self::send(&self.sender, std::mem::take(pending)).await;
        }
    }

    /// Sends one message, waiting while the channel is full.
    async fn send(sender: &mpsc::Sender<Vec<u8>>, output: Vec<u8>) {
        // A reader that has gone away, as a closed page, loses the rest: the command goes on without it.
        let _ = sender.send(output).await;
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;

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
        let mut forward = Forward::new(&Output::Lines(sender)).expect("lines are streamed");

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
        let mut forward = Forward::new(&Output::Lines(sender)).expect("lines are streamed");

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
        let mut forward = Forward::new(&Output::Chunks(sender)).expect("chunks are streamed");

        forward.write(b"Pull").await;
        forward.write(b"ing\n").await;
        forward.finish().await;

        assert_eq!(received(receiver), [b"Pull".to_vec(), b"ing\n".to_vec()]);
    }

    #[tokio::test]
    async fn goes_on_once_the_reader_is_gone() {
        let (sender, receiver) = mpsc::channel(1);
        let mut forward = Forward::new(&Output::Lines(sender)).expect("lines are streamed");

        drop(receiver);

        // More lines than the channel holds: a full channel would wait, a closed one does not.
        forward.write(b"one\ntwo\nthree\n").await;
        forward.finish().await;
    }

    #[test]
    fn an_inherited_output_has_nothing_to_forward() {
        assert!(Forward::new(&Output::Inherit).is_none());
    }
}
