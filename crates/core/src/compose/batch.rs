//! A compose command over several apps, which runs on its own and keeps its output for whoever listens.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};

use futures::Stream;
use tokio::sync::watch;

use super::{ComposeCommand, ComposeError};

/// A compose command running over several apps, on its own: [`Compose::batch`](crate::Compose::batch) starts it, and
/// it goes on to its end whoever drops this handle or its output, as a page that is closed. Cloning the handle is
/// cheap, and the clones share the batch.
///
/// Its output is kept for whoever listens, from its start: [`output`](Self::output) streams what came already, then
/// what comes, as many times as it is called. The batch never waits for a listener: it keeps the last MiB of the
/// output, and a listener that comes later, or falls further behind, is told how many events it missed. The output
/// is kept as long as a handle or an output stream is.
#[derive(Debug, Clone)]
pub struct ComposeBatch {
    shared: Arc<Shared>,
}

/// What a batch tells its listeners.
#[derive(Debug, Clone)]
pub enum BatchEvent {
    /// The command starts on `app`.
    Started {
        /// The app.
        app: String,
    },

    /// A line that `docker compose` printed on `app`, stdout and stderr together, with its newline. The lines of an
    /// app come between its [`Started`](Self::Started) and its [`Finished`](Self::Finished); those of several apps
    /// interleave when the command runs on them at once, as `pull`.
    Output {
        /// The app.
        app: String,
        /// The line.
        line: Vec<u8>,
    },

    /// The command ended on an app.
    Finished(AppOutcome),

    /// The events that this listener missed, which the batch no longer kept: it keeps the last MiB of output.
    Skipped {
        /// How many.
        events: u64,
    },
}

/// How the command ended on one app.
#[derive(Debug, Clone)]
pub struct AppOutcome {
    /// The app.
    pub app: String,
    /// The outcome, shared by every listener.
    pub result: Result<(), Arc<ComposeError>>,
}

/// How a batch ended: one outcome per app, in the order they ended.
#[derive(Debug, Clone, Default)]
pub struct BatchReport {
    /// The outcomes. An app is missing when its run did not end, as when the task of the batch was dropped with the
    /// runtime it ran on.
    pub apps: Vec<AppOutcome>,
}

/// What the handles of a batch, its output streams and its recorder share.
#[derive(Debug)]
struct Shared {
    command: ComposeCommand,
    apps: Vec<String>,
    log: Mutex<Log>,
    /// Told whenever the log changes.
    changed: watch::Sender<()>,
}

/// The events of a batch, the last MiB of them, and its outcomes.
#[derive(Debug, Default)]
struct Log {
    events: VecDeque<BatchEvent>,
    /// The number of the first event kept: those before it were dropped.
    first: u64,
    /// The bytes the events kept hold.
    bytes: usize,
    outcomes: Vec<AppOutcome>,
    is_finished: bool,
}

/// What a listener reads next.
enum Read {
    Event(BatchEvent),
    Skipped(u64),
    Wait,
    End,
}

/// The side of a batch that runs it: it records what happens, and finishes the batch when it is dropped, so that a
/// task that ends any way, by a panic or with its runtime, never leaves listeners waiting.
#[derive(Debug)]
pub(crate) struct BatchRecorder {
    shared: Arc<Shared>,
}

impl ComposeBatch {
    /// A batch of `command` over `apps`, in the order they run in, and the recorder its task writes to.
    pub(crate) fn new(command: ComposeCommand, apps: Vec<String>) -> (Self, BatchRecorder) {
        let shared = Arc::new(Shared {
            command,
            apps,
            log: Mutex::new(Log::default()),
            changed: watch::Sender::new(()),
        });
        let recorder = BatchRecorder {
            shared: Arc::clone(&shared),
        };

        (Self { shared }, recorder)
    }

    /// The command the batch runs.
    pub fn command(&self) -> ComposeCommand {
        self.shared.command
    }

    /// The apps, in the order the command runs on them; at once for `pull`.
    pub fn apps(&self) -> &[String] {
        &self.shared.apps
    }

    /// Whether the command ended on every app.
    pub fn is_finished(&self) -> bool {
        self.shared.log().is_finished
    }

    /// The output of the batch from its start, as far as it is kept, then as it comes; the stream ends once the batch
    /// is over. It holds the batch's output, not the batch: dropping it, or never reading it, does not stop the
    /// batch, nor slow it.
    pub fn output(&self) -> impl Stream<Item = BatchEvent> + Send + 'static {
        let listener = Listener {
            shared: Arc::clone(&self.shared),
            changes: self.shared.changed.subscribe(),
            next: 0,
        };

        futures::stream::unfold(listener, |mut listener| async move {
            let event = listener.next().await?;

            Some((event, listener))
        })
    }

    /// Waits for the batch to end, and returns how it ended on each app.
    pub async fn finished(&self) -> BatchReport {
        let mut changes = self.shared.changed.subscribe();

        loop {
            changes.borrow_and_update();

            {
                let log = self.shared.log();

                if log.is_finished {
                    return BatchReport {
                        apps: log.outcomes.clone(),
                    };
                }
            }

            // The sender lives in `shared`, which this handle holds: the channel stays open.
            let _ = changes.changed().await;
        }
    }
}

impl BatchReport {
    /// How many apps the command failed on.
    pub fn failures(&self) -> usize {
        self.apps
            .iter()
            .filter(|outcome| outcome.result.is_err())
            .count()
    }
}

impl BatchRecorder {
    /// Records that the command starts on `app`.
    pub(crate) fn started(&self, app: &str) {
        self.shared.push(BatchEvent::Started {
            app: app.to_owned(),
        });
    }

    /// Records a line the command printed on `app`.
    pub(crate) fn line(&self, app: &str, line: Vec<u8>) {
        self.shared.push(BatchEvent::Output {
            app: app.to_owned(),
            line,
        });
    }

    /// Records how the command ended on an app.
    pub(crate) fn finished(&self, outcome: AppOutcome) {
        self.shared.log().outcomes.push(outcome.clone());
        self.shared.push(BatchEvent::Finished(outcome));
    }
}

impl Drop for BatchRecorder {
    fn drop(&mut self) {
        self.shared.log().is_finished = true;
        self.shared.changed.send_replace(());
    }
}

impl Shared {
    /// The log, which no code leaves inconsistent while holding it.
    fn log(&self) -> MutexGuard<'_, Log> {
        self.log
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Adds an event to the log, and tells the listeners.
    fn push(&self, event: BatchEvent) {
        self.log().push(event);
        self.changed.send_replace(());
    }
}

impl Log {
    /// How much output a batch keeps for its listeners.
    const MAX_BYTES: usize = 1024 * 1024;

    /// Adds an event, and drops the oldest ones past [`MAX_BYTES`](Self::MAX_BYTES).
    fn push(&mut self, event: BatchEvent) {
        self.bytes += Self::size(&event);
        self.events.push_back(event);

        while self.bytes > Self::MAX_BYTES {
            let Some(oldest) = self.events.pop_front() else {
                break;
            };

            self.bytes -= Self::size(&oldest);
            self.first += 1;
        }
    }

    /// The event numbered `next`, or what stands in its place, and the number to read after it.
    fn read(&self, next: u64) -> (Read, u64) {
        if next < self.first {
            return (Read::Skipped(self.first - next), self.first);
        }

        let index = usize::try_from(next - self.first).unwrap_or(usize::MAX);

        if let Some(event) = self.events.get(index) {
            return (Read::Event(event.clone()), next + 1);
        }

        if self.is_finished {
            return (Read::End, next);
        }

        (Read::Wait, next)
    }

    /// The bytes an event holds.
    fn size(event: &BatchEvent) -> usize {
        match event {
            BatchEvent::Started { app } => app.len(),
            BatchEvent::Output { app, line } => app.len() + line.len(),
            BatchEvent::Finished(outcome) => outcome.app.len(),
            BatchEvent::Skipped { .. } => 0,
        }
    }
}

/// One listener of a batch: where it is in the log.
struct Listener {
    shared: Arc<Shared>,
    changes: watch::Receiver<()>,
    /// The number of the next event to read.
    next: u64,
}

impl Listener {
    /// The next event, once there is one; `None` once the batch is over and every event was read.
    async fn next(&mut self) -> Option<BatchEvent> {
        loop {
            // Marked seen before the log is read: an event pushed after the read changes the channel again.
            self.changes.borrow_and_update();

            let (read, next) = self.shared.log().read(self.next);

            self.next = next;

            match read {
                Read::Event(event) => return Some(event),
                Read::Skipped(events) => return Some(BatchEvent::Skipped { events }),
                Read::End => return None,
                Read::Wait => {
                    // The sender lives in `shared`, which the listener holds: the channel stays open.
                    let _ = self.changes.changed().await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;

    use super::{BatchEvent, ComposeBatch, Log};
    use crate::ComposeCommand;

    #[tokio::test]
    async fn keeps_the_last_mib_and_tells_a_late_listener_what_it_missed() {
        let (batch, recorder) = ComposeBatch::new(ComposeCommand::Pull, vec!["web".into()]);
        // With the app's name, each line holds 1 KiB.
        let line = vec![b'.'; 1024 - "web".len()];
        let lines = 2 * Log::MAX_BYTES / 1024;

        recorder.started("web");

        for _ in 0..lines {
            recorder.line("web", line.clone());
        }

        drop(recorder);

        let events: Vec<BatchEvent> = batch.output().collect().await;
        let BatchEvent::Skipped { events: missed } = events[0] else {
            panic!("the first event says what was missed: {:?}", events[0]);
        };

        assert_eq!(events.len() - 1, Log::MAX_BYTES / 1024);
        assert_eq!(missed, 1 + (lines - Log::MAX_BYTES / 1024) as u64);
        assert!(batch.is_finished());
    }

    #[tokio::test]
    async fn ends_the_listeners_of_a_batch_whose_recorder_is_dropped() {
        let (batch, recorder) = ComposeBatch::new(ComposeCommand::Down, vec!["web".into()]);
        let output = batch.output();

        recorder.started("web");
        drop(recorder);

        let events: Vec<BatchEvent> = output.collect().await;

        assert!(matches!(&events[..], [BatchEvent::Started { app }] if app == "web"));
        assert!(batch.finished().await.apps.is_empty());
    }
}
