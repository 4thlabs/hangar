//! Where the output of a run goes, and how it is cut on the way.

use std::collections::VecDeque;
use std::pin::pin;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::{Notify, mpsc};
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
/// The run sets no bound of its own on a stalled reader: the server of the HTTP stream does. quoll's `serve` and
/// `serve_on` cut a connection whose socket takes no write for 60 s, once the kernel's buffers are full, and drop
/// its stream with the receiver it holds: a client that stops reading without closing its connection is then a
/// reader that has gone away. A router served with `axum::serve` has no such bound, and its stalled client holds the
/// run until it is cancelled.
///
/// Once the run is stopping, after a cancel or a pipe that can no longer be read, the pipes no longer wait for the
/// channel, so that a stalled reader never holds back a child that stops: what they give goes to a queue of 1 MiB,
/// which the channel is fed from as the reader takes it, so that a reader that keeps up loses nothing. What does not
/// fit is dropped, a whole line or chunk at a time, and so is what is left at the cut that
/// [`Runtime`](crate::Runtime) describes. A run that dropped output does not succeed.
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

/// The output of a run on its way to the channel: both streams, in the order they come, through a queue that the
/// channel is fed from. [`Outbox::flush`] feeds it; each stream writes through its own [`Forward`].
#[derive(Debug)]
pub(crate) struct Outbox {
    shared: Arc<Shared>,
    sender: mpsc::Sender<Vec<u8>>,
    /// Whether the forwards cut the output into lines.
    is_lines: bool,
}

/// Sends one stream of a child, its stdout or its stderr, to the [`Outbox`] of its run, cut as its [`Output`] says.
#[derive(Debug)]
pub(crate) struct Forward {
    shared: Arc<Shared>,
    /// The start of a line still to end, for [`Output::Lines`]; `None` sends chunks as they come.
    pending_line: Option<Vec<u8>>,
    is_finished: bool,
}

/// What the forwards of a run and its outbox share.
#[derive(Debug)]
struct Shared {
    queue: Mutex<Queue>,
    /// Told whenever the queue changes.
    changed: Notify,
    /// Cancelled once the run is stopping: the forwards no longer wait for the channel.
    stop: CancellationToken,
    /// Cancelled at the cut of a stopped run: what is left is dropped.
    cut: CancellationToken,
}

/// The messages on their way to the channel.
#[derive(Debug, Default)]
struct Queue {
    messages: VecDeque<Vec<u8>>,
    bytes: usize,
    /// The forwards still writing.
    writers: usize,
    /// Whether output was dropped, which makes the run fail.
    has_dropped: bool,
    /// Whether the reader went away, which loses the rest without failing the run.
    is_reader_gone: bool,
}

impl Outbox {
    /// How much a stopping run keeps for its reader.
    const MAX_QUEUE_BYTES: usize = 1024 * 1024;

    /// The outbox of a run, which stops waiting for its reader once `stop` is cancelled and drops what is left at
    /// `cut`; `None` when the output is not streamed.
    pub(crate) fn new(
        output: &Output,
        stop: &CancellationToken,
        cut: &CancellationToken,
    ) -> Option<Self> {
        let (sender, is_lines) = match output {
            Output::Inherit => return None,
            Output::Lines(sender) => (sender, true),
            Output::Chunks(sender) => (sender, false),
        };

        Some(Self {
            shared: Arc::new(Shared {
                queue: Mutex::new(Queue::default()),
                changed: Notify::new(),
                stop: stop.clone(),
                cut: cut.clone(),
            }),
            sender: sender.clone(),
            is_lines,
        })
    }

    /// A forward for one stream of the run.
    pub(crate) fn forward(&self) -> Forward {
        self.shared.queue().writers += 1;

        Forward {
            shared: Arc::clone(&self.shared),
            pending_line: self.is_lines.then(Vec::new),
            is_finished: false,
        }
    }

    /// Feeds the channel from the queue, as the reader takes it, until every forward finished and the queue is empty,
    /// or the cut, which drops what is left.
    pub(crate) async fn flush(&self) {
        loop {
            let mut changed = pin!(self.shared.changed.notified());

            changed.as_mut().enable();

            let (has_message, is_over) = {
                let queue = self.shared.queue();

                (
                    !queue.messages.is_empty(),
                    queue.writers == 0 && queue.messages.is_empty(),
                )
            };

            if is_over {
                return;
            }

            if !has_message {
                tokio::select! {
                    () = changed => continue,
                    () = self.shared.cut.cancelled() => {
                        // A message may have come with the cut: it is dropped, and counted.
                        self.shared.drop_all();
                        return;
                    }
                }
            }

            let permit = tokio::select! {
                biased;
                permit = self.sender.reserve() => permit,
                () = self.shared.cut.cancelled() => {
                    self.shared.drop_all();
                    return;
                }
            };

            // A reader that has gone away, as a closed page, loses the rest: the command goes on without it.
            let Ok(permit) = permit else {
                self.shared.lose_reader();
                continue;
            };

            if let Some(message) = self.shared.pop() {
                permit.send(message);
            }
        }
    }

    /// Whether the run dropped output, as a stopping run whose reader did not keep up.
    pub(crate) fn has_dropped(&self) -> bool {
        self.shared.queue().has_dropped
    }
}

impl Forward {
    /// How long a line may grow before it is sent in pieces: a child printing no newline must not grow memory.
    const MAX_LINE_BYTES: usize = 64 * 1024;

    /// Sends what the child wrote, or keeps the start of a line until its end comes.
    pub(crate) async fn write(&mut self, chunk: &[u8]) {
        let Some(pending) = &mut self.pending_line else {
            Self::send(&self.shared, chunk.to_vec()).await;
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
                    Self::send(&self.shared, std::mem::take(pending)).await;
                }
            }
        }
    }

    /// Sends the last line, which the child did not end with a newline, and says this stream is over.
    pub(crate) async fn finish(&mut self) {
        if let Some(pending) = &mut self.pending_line
            && !pending.is_empty()
        {
            Self::send(&self.shared, std::mem::take(pending)).await;
        }

        self.end();
    }

    /// Queues one message: once the queue is empty while the run goes on, at once once it is stopping.
    async fn send(shared: &Shared, message: Vec<u8>) {
        let mut message = message;

        loop {
            let mut changed = pin!(shared.changed.notified());

            changed.as_mut().enable();

            let Some(waiting) = shared.offer(message) else {
                return;
            };

            message = waiting;

            tokio::select! {
                () = changed => {}
                () = shared.stop.cancelled() => {}
                () = shared.cut.cancelled() => {}
            }
        }
    }

    /// Says this stream is over, once.
    fn end(&mut self) {
        if self.is_finished {
            return;
        }

        self.is_finished = true;
        self.shared.queue().writers -= 1;
        self.shared.changed.notify_waiters();
    }
}

impl Drop for Forward {
    fn drop(&mut self) {
        self.end();
    }
}

impl Shared {
    /// The queue, which no code leaves inconsistent while holding it.
    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Takes `message`, or hands it back when it has to wait: while the run goes on, for the queue to be empty, so
    /// that the reader holds the child back; once it is stopping, it is queued if it fits and dropped if not.
    fn offer(&self, message: Vec<u8>) -> Option<Vec<u8>> {
        let mut queue = self.queue();

        if queue.is_reader_gone {
            return None;
        }

        if self.cut.is_cancelled() {
            queue.has_dropped = true;
            return None;
        }

        let is_stopping = self.stop.is_cancelled();

        if !is_stopping && !queue.messages.is_empty() {
            return Some(message);
        }

        if queue.bytes + message.len() > Outbox::MAX_QUEUE_BYTES {
            queue.has_dropped = true;
            return None;
        }

        queue.bytes += message.len();
        queue.messages.push_back(message);
        drop(queue);
        self.changed.notify_waiters();

        None
    }

    /// Takes the oldest message out, to send it.
    fn pop(&self) -> Option<Vec<u8>> {
        let mut queue = self.queue();
        let message = queue.messages.pop_front()?;

        queue.bytes -= message.len();
        drop(queue);
        self.changed.notify_waiters();

        Some(message)
    }

    /// Drops what is left, at the cut.
    fn drop_all(&self) {
        let mut queue = self.queue();

        if !queue.messages.is_empty() {
            queue.has_dropped = true;
        }

        queue.messages.clear();
        queue.bytes = 0;
        drop(queue);
        self.changed.notify_waiters();
    }

    /// Forgets the queue and what comes, the reader having gone away.
    fn lose_reader(&self) {
        let mut queue = self.queue();

        queue.is_reader_gone = true;
        queue.messages.clear();
        queue.bytes = 0;
        drop(queue);
        self.changed.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;

    use super::{Forward, Outbox, Output};

    /// What the channel received, each message apart.
    fn received(mut receiver: mpsc::Receiver<Vec<u8>>) -> Vec<Vec<u8>> {
        let mut messages = Vec::new();

        while let Ok(message) = receiver.try_recv() {
            messages.push(message);
        }

        messages
    }

    /// Writes `chunks` through one forward of `outbox`, then finishes it, while the outbox feeds the channel.
    async fn deliver(outbox: &Outbox, chunks: &[&[u8]]) {
        let mut forward = outbox.forward();
        let writing = async move {
            for chunk in chunks {
                forward.write(chunk).await;
            }

            forward.finish().await;
        };

        tokio::join!(writing, outbox.flush());
    }

    /// An outbox for `output` that nothing stops.
    fn outbox(output: &Output) -> Outbox {
        Outbox::new(output, &CancellationToken::new(), &CancellationToken::new()).expect("streamed")
    }

    #[tokio::test]
    async fn sends_whole_lines_whatever_the_chunks() {
        let (sender, receiver) = mpsc::channel(16);
        let outbox = outbox(&Output::Lines(sender));

        deliver(
            &outbox,
            &[b"Pulling web\nPull", b"ing db", b"\nDone\nwith no newline"],
        )
        .await;

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
        let outbox = outbox(&Output::Lines(sender));

        deliver(&outbox, &[&vec![b'.'; Forward::MAX_LINE_BYTES + 10]]).await;

        let lengths: Vec<usize> = received(receiver).iter().map(Vec::len).collect();

        assert_eq!(lengths, [Forward::MAX_LINE_BYTES, 10]);
    }

    #[tokio::test]
    async fn sends_chunks_as_they_come() {
        let (sender, receiver) = mpsc::channel(16);
        let outbox = outbox(&Output::Chunks(sender));

        deliver(&outbox, &[b"Pull", b"ing\n"]).await;

        assert_eq!(received(receiver), [b"Pull".to_vec(), b"ing\n".to_vec()]);
    }

    #[tokio::test]
    async fn waits_for_a_slow_reader_while_the_run_goes_on() {
        let (sender, mut receiver) = mpsc::channel(1);
        let outbox = outbox(&Output::Lines(sender));
        let mut forward = outbox.forward();

        let writing = async move {
            forward.write(b"one\ntwo\nthree\n").await;
            forward.finish().await;
        };
        let reading = async {
            let mut lines = Vec::new();

            for _ in 0..3 {
                // The forward waits for the reader: the queue never holds more than the message on its way.
                assert!(outbox.shared.queue().messages.len() <= 1);

                lines.push(receiver.recv().await.expect("a line"));
                tokio::task::yield_now().await;
            }

            lines
        };

        let ((), (), lines) = tokio::join!(writing, outbox.flush(), reading);

        assert_eq!(
            lines,
            [b"one\n".to_vec(), b"two\n".to_vec(), b"three\n".to_vec()]
        );
    }

    #[tokio::test]
    async fn queues_for_a_reader_that_keeps_up_once_stopping() {
        let (sender, mut receiver) = mpsc::channel(1);
        let stop = CancellationToken::new();
        let outbox = Outbox::new(&Output::Lines(sender), &stop, &CancellationToken::new())
            .expect("streamed");
        let mut forward = outbox.forward();

        stop.cancel();

        // The forward does not wait: the queue holds what the channel cannot take yet.
        forward.write(b"one\ntwo\nthree\n").await;
        forward.finish().await;

        // The outbox holds the sender: the channel stays open, so the reader takes the three lines it expects.
        let reading = async {
            let mut lines = Vec::new();

            for _ in 0..3 {
                lines.push(receiver.recv().await.expect("a line"));
            }

            lines
        };

        let ((), lines) = tokio::join!(outbox.flush(), reading);

        assert_eq!(
            lines,
            [b"one\n".to_vec(), b"two\n".to_vec(), b"three\n".to_vec()]
        );
        assert!(!outbox.has_dropped());
    }

    #[tokio::test]
    async fn drops_whole_messages_that_do_not_fit_once_stopping() {
        let (sender, _stalled) = mpsc::channel(1);
        let stop = CancellationToken::new();
        let outbox = Outbox::new(&Output::Chunks(sender), &stop, &CancellationToken::new())
            .expect("streamed");
        let mut forward = outbox.forward();
        let half = vec![b'.'; Outbox::MAX_QUEUE_BYTES / 2];

        stop.cancel();

        // Nobody reads: two halves fit, the third is dropped whole, and nothing waits.
        for _ in 0..3 {
            forward.write(&half).await;
        }

        assert!(outbox.has_dropped());
        assert_eq!(outbox.shared.queue().messages.len(), 2);
    }

    #[tokio::test]
    async fn drops_what_is_left_at_the_cut() {
        let (sender, _stalled) = mpsc::channel(1);
        let stop = CancellationToken::new();
        let cut = CancellationToken::new();
        let outbox = Outbox::new(&Output::Lines(sender), &stop, &cut).expect("streamed");
        let mut forward = outbox.forward();

        stop.cancel();
        forward.write(b"one\ntwo\nthree\n").await;

        let cutting = async {
            tokio::task::yield_now().await;
            cut.cancel();
        };

        tokio::join!(outbox.flush(), cutting);

        assert!(outbox.has_dropped());
        assert!(outbox.shared.queue().messages.is_empty());
    }

    #[tokio::test]
    async fn goes_on_once_the_reader_is_gone() {
        let (sender, receiver) = mpsc::channel(1);
        let outbox = outbox(&Output::Lines(sender));

        drop(receiver);

        // More lines than the channel holds: a full channel would wait, a closed one does not.
        deliver(&outbox, &[b"one\ntwo\nthree\n"]).await;

        assert!(!outbox.has_dropped());
    }

    #[test]
    fn an_inherited_output_has_no_outbox() {
        let none = CancellationToken::new();

        assert!(Outbox::new(&Output::Inherit, &none, &none).is_none());
    }
}
