//! Where the output of a run goes, and how it is cut on the way.

use std::fmt;
use std::sync::Arc;

/// What receives the output of a streamed run: a compose batch's, which several runs share, or an HTTP stream's.
///
/// It is called from async code, so it must not block: it sends to an unbounded channel, not a bounded one, and a
/// reader that has gone away drops the rest rather than holding the command back. Any `Fn(&[u8])` is a sink.
///
/// ```
/// use std::sync::Arc;
///
/// use hangar_core::{Output, OutputSink};
/// use tokio::sync::mpsc;
///
/// let (sender, _receiver) = mpsc::unbounded_channel::<Vec<u8>>();
/// let sink: Arc<dyn OutputSink> = Arc::new(move |line: &[u8]| {
///     // The reader may be gone: the command goes on regardless.
///     let _ = sender.send(line.to_vec());
/// });
///
/// let output = Output::Lines(sink);
/// # drop(output);
/// ```
pub trait OutputSink: Send + Sync {
    /// Receives the next piece of output: a line or a chunk, as [`Output`] says.
    fn write(&self, output: &[u8]);
}

impl<F> OutputSink for F
where
    F: Fn(&[u8]) + Send + Sync,
{
    fn write(&self, output: &[u8]) {
        self(output);
    }
}

/// Where a run sends its stdout and stderr. A captured run keeps stdout alone instead, through
/// [`CommandRunner::capture`](crate::CommandRunner::capture).
#[derive(Clone)]
pub enum Output {
    /// The child writes to this process's own stdout and stderr, a terminal's in the CLI. Its stderr then does not
    /// reach the error of a failed run.
    Inherit,

    /// stdout and stderr go together to the sink, one line per write, with its newline. A line of more than 64 KiB
    /// comes in pieces, and the last one lacks its newline when the output does not end with one.
    Lines(Arc<dyn OutputSink>),

    /// stdout and stderr go together to the sink, a chunk per write, as the child writes them.
    Chunks(Arc<dyn OutputSink>),
}

impl fmt::Debug for Output {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Inherit => formatter.write_str("Inherit"),
            Self::Lines(_) => formatter.write_str("Lines(..)"),
            Self::Chunks(_) => formatter.write_str("Chunks(..)"),
        }
    }
}

/// Sends one stream of a child, its stdout or its stderr, to a sink, cut as its [`Output`] says.
pub(crate) struct Forward {
    sink: Arc<dyn OutputSink>,
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
            Output::Lines(sink) => Some(Self {
                sink: Arc::clone(sink),
                pending_line: Some(Vec::new()),
            }),
            Output::Chunks(sink) => Some(Self {
                sink: Arc::clone(sink),
                pending_line: None,
            }),
        }
    }

    /// Sends what the child wrote, or keeps the start of a line until its end comes.
    pub(crate) fn write(&mut self, chunk: &[u8]) {
        let Some(pending) = &mut self.pending_line else {
            self.sink.write(chunk);
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
                    self.sink.write(pending);
                    pending.clear();
                }
            }
        }
    }

    /// Sends the last line, which the child did not end with a newline.
    pub(crate) fn finish(&mut self) {
        let Some(pending) = &mut self.pending_line else {
            return;
        };

        if !pending.is_empty() {
            self.sink.write(pending);
            pending.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{Forward, Output};

    /// A sink that keeps each write apart.
    fn recording_sink() -> (Output, Output, Arc<Mutex<Vec<Vec<u8>>>>) {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&writes);
        let sink = Arc::new(move |output: &[u8]| {
            recorded
                .lock()
                .expect("no test panics while holding the lock")
                .push(output.to_vec());
        });

        (Output::Lines(sink.clone()), Output::Chunks(sink), writes)
    }

    #[test]
    fn sends_whole_lines_whatever_the_chunks() {
        let (lines, _, writes) = recording_sink();
        let mut forward = Forward::new(&lines).expect("lines are streamed");

        forward.write(b"Pulling web\nPull");
        forward.write(b"ing db");
        forward.write(b"\nDone\nwith no newline");
        forward.finish();

        assert_eq!(
            *writes.lock().expect("the forward is done"),
            [
                b"Pulling web\n".to_vec(),
                b"Pulling db\n".to_vec(),
                b"Done\n".to_vec(),
                b"with no newline".to_vec(),
            ]
        );
    }

    #[test]
    fn cuts_a_line_that_never_ends() {
        let (lines, _, writes) = recording_sink();
        let mut forward = Forward::new(&lines).expect("lines are streamed");

        forward.write(&vec![b'.'; Forward::MAX_LINE_BYTES + 10]);
        forward.finish();

        let lengths: Vec<usize> = writes
            .lock()
            .expect("the forward is done")
            .iter()
            .map(Vec::len)
            .collect();

        assert_eq!(lengths, [Forward::MAX_LINE_BYTES, 10]);
    }

    #[test]
    fn sends_chunks_as_they_come() {
        let (_, chunks, writes) = recording_sink();
        let mut forward = Forward::new(&chunks).expect("chunks are streamed");

        forward.write(b"Pull");
        forward.write(b"ing\n");
        forward.finish();

        assert_eq!(
            *writes.lock().expect("the forward is done"),
            [b"Pull".to_vec(), b"ing\n".to_vec()]
        );
    }

    #[test]
    fn an_inherited_output_has_nothing_to_forward() {
        assert!(Forward::new(&Output::Inherit).is_none());
    }
}
