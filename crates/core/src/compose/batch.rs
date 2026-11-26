//! A compose command over several apps, which runs on its own and keeps its output for whoever listens.

use std::collections::VecDeque;
use std::error::Error;
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

/// What a batch does once the command fails on an app.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum OnFailure {
    /// Runs the command on the other apps all the same, as the Apps page does: each app has its own outcome.
    #[default]
    CarryOn,
    /// Runs it on no app after the one that failed, as the CLI's `store up` and `store down` do; the apps after it are
    /// [not run](AppStatus::NotRun). `pull`, which runs on every app at once, carries on all the same.
    Stop,
}

/// What a batch tells its listeners.
#[derive(Debug, Clone)]
pub enum BatchEvent {
    /// The command starts on `app`.
    Started {
        /// The app.
        app: Arc<str>,
    },

    /// A line that `docker compose` printed on `app`, stdout and stderr together, with its newline. The lines of an
    /// app come between its [`Started`](Self::Started) and its [`Finished`](Self::Finished); those of several apps
    /// interleave when the command runs on them at once, as `pull`.
    Output {
        /// The app.
        app: Arc<str>,
        /// The line.
        line: Vec<u8>,
    },

    /// The command ended on an app, or the batch ended without running it there: every app of the batch has one.
    Finished(AppOutcome),

    /// The events that this listener missed, which the batch no longer kept: it keeps the last MiB of output.
    Skipped {
        /// How many.
        events: u64,
    },
}

/// How the batch ended on one app.
#[derive(Debug, Clone)]
pub struct AppOutcome {
    /// The app.
    pub app: Arc<str>,
    /// How it ended.
    pub status: AppStatus,
}

/// How the batch ended on one app.
#[derive(Debug, Clone)]
pub enum AppStatus {
    /// The command succeeded.
    Succeeded,
    /// The command failed; the error is shared by every listener.
    Failed(Arc<ComposeError>),
    /// The command did not run on the app, or did not end: the batch stopped at an earlier failure, or its task ended
    /// before, by a panic or with the runtime it ran on.
    NotRun,
}

/// How a batch ended: one outcome per app, in the order of [`ComposeBatch::apps`].
#[derive(Debug, Clone, Default)]
pub struct BatchReport {
    /// The outcomes.
    pub apps: Vec<AppOutcome>,
}

/// What the handles of a batch, its output streams and its recorder share.
#[derive(Debug)]
struct Shared {
    command: ComposeCommand,
    apps: Vec<Arc<str>>,
    log: Mutex<Log>,
    /// Told whenever the log changes.
    changed: watch::Sender<()>,
}

/// The events of a batch, the last MiB of them, and its outcomes.
#[derive(Debug, Default)]
struct Log {
    entries: VecDeque<Entry>,
    /// The number of the first event kept: those before it were dropped.
    first: u64,
    /// The bytes the events kept cost.
    bytes: usize,
    outcomes: Vec<AppOutcome>,
    is_finished: bool,
}

/// An event of the log, and what it costs.
#[derive(Debug)]
struct Entry {
    event: BatchEvent,
    bytes: usize,
}

/// What a listener reads next.
enum Read {
    Event(BatchEvent),
    Skipped(u64),
    Wait,
    End,
}

/// The side of a batch that runs it: it records what happens, and finishes the batch when it is dropped, with the
/// apps that have no outcome yet as not run, so that a task that ends any way, by a panic or with its runtime, never
/// leaves listeners waiting nor passes for a success.
#[derive(Debug)]
pub(crate) struct BatchRecorder {
    shared: Arc<Shared>,
}

impl ComposeBatch {
    /// A batch of `command` over `apps`, in the order they run in, and the recorder its task writes to.
    pub(crate) fn new(command: ComposeCommand, apps: Vec<Arc<str>>) -> (Self, BatchRecorder) {
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
    pub fn command(&self) -> &ComposeCommand {
        &self.shared.command
    }

    /// The apps, in the order the command runs on them; at once for `pull`.
    pub fn apps(&self) -> &[Arc<str>] {
        &self.shared.apps
    }

    /// Whether the batch is over.
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

            if let Some(report) = self.shared.report() {
                return report;
            }

            // The sender lives in `shared`, which this handle holds: the channel stays open.
            let _ = changes.changed().await;
        }
    }
}

impl AppStatus {
    /// Whether the command succeeded on the app.
    pub fn is_success(&self) -> bool {
        matches!(self, Self::Succeeded)
    }
}

impl BatchReport {
    /// How many apps the command failed on or did not run on.
    pub fn failures(&self) -> usize {
        self.apps
            .iter()
            .filter(|outcome| !outcome.status.is_success())
            .count()
    }
}

impl BatchRecorder {
    /// Records that the command starts on `app`.
    pub(crate) fn started(&self, app: &Arc<str>) {
        self.shared.push(BatchEvent::Started {
            app: Arc::clone(app),
        });
    }

    /// Records a line the command printed on `app`.
    pub(crate) fn line(&self, app: &Arc<str>, line: Vec<u8>) {
        self.shared.push(BatchEvent::Output {
            app: Arc::clone(app),
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
        let not_run: Vec<Arc<str>> = {
            let log = self.shared.log();

            self.shared
                .apps
                .iter()
                .filter(|app| !log.outcomes.iter().any(|outcome| outcome.app == **app))
                .cloned()
                .collect()
        };

        for app in not_run {
            self.finished(AppOutcome {
                app,
                status: AppStatus::NotRun,
            });
        }

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

    /// The report of the batch, once it is over: the recorder gave every app an outcome as it was dropped.
    fn report(&self) -> Option<BatchReport> {
        let log = self.log();

        if !log.is_finished {
            return None;
        }

        let apps = self
            .apps
            .iter()
            .map(|app| {
                log.outcomes
                    .iter()
                    .find(|outcome| outcome.app == *app)
                    .cloned()
                    .unwrap_or_else(|| AppOutcome {
                        app: Arc::clone(app),
                        status: AppStatus::NotRun,
                    })
            })
            .collect();

        Some(BatchReport { apps })
    }
}

impl Log {
    /// How much output a batch keeps for its listeners.
    const MAX_BYTES: usize = 1024 * 1024;

    /// What an event costs beyond its text: its entry in the log, and the allocation of its line, rounded up. The
    /// app's name is shared by all its events, and not counted.
    const EVENT_BYTES: usize = 128;

    /// Adds an event, and drops the oldest ones past [`MAX_BYTES`](Self::MAX_BYTES).
    fn push(&mut self, event: BatchEvent) {
        let bytes = Self::cost(&event);

        self.bytes += bytes;
        self.entries.push_back(Entry { event, bytes });

        while self.bytes > Self::MAX_BYTES {
            let Some(oldest) = self.entries.pop_front() else {
                break;
            };

            self.bytes -= oldest.bytes;
            self.first += 1;
        }
    }

    /// The event numbered `next`, or what stands in its place, and the number to read after it.
    fn read(&self, next: u64) -> (Read, u64) {
        if next < self.first {
            return (Read::Skipped(self.first - next), self.first);
        }

        let index = usize::try_from(next - self.first).unwrap_or(usize::MAX);

        if let Some(entry) = self.entries.get(index) {
            return (Read::Event(entry.event.clone()), next + 1);
        }

        if self.is_finished {
            return (Read::End, next);
        }

        (Read::Wait, next)
    }

    /// The bytes an event costs: a fixed cost, and its text.
    fn cost(event: &BatchEvent) -> usize {
        let text = match event {
            BatchEvent::Output { line, .. } => line.len(),
            BatchEvent::Finished(AppOutcome {
                status: AppStatus::Failed(error),
                ..
            }) => Self::text(error.as_ref()),
            BatchEvent::Started { .. } | BatchEvent::Finished(_) | BatchEvent::Skipped { .. } => 0,
        };

        Self::EVENT_BYTES + text
    }

    /// The text an error holds, its sources' included: the stderr of a failed run.
    fn text<'a>(error: &'a (dyn Error + 'static)) -> usize {
        std::iter::successors(Some(error), |error: &&'a (dyn Error + 'static)| {
            (*error).source()
        })
        .map(|error| error.to_string().len())
        .sum()
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
    use std::sync::Arc;

    use futures::StreamExt;

    use super::{AppOutcome, AppStatus, BatchEvent, ComposeBatch, Log};
    use crate::ComposeCommand;

    #[tokio::test]
    async fn keeps_the_last_mib_and_tells_a_late_listener_what_it_missed() {
        let web: Arc<str> = Arc::from("web");
        let (batch, recorder) = ComposeBatch::new(ComposeCommand::Pull, vec![Arc::clone(&web)]);
        // With its fixed cost, each line costs 1 KiB.
        let line = vec![b'.'; 1024 - Log::EVENT_BYTES];
        let kept = Log::MAX_BYTES / 1024;
        let lines = 2 * kept;

        recorder.started(&web);

        for _ in 0..lines {
            recorder.line(&web, line.clone());
        }

        recorder.finished(AppOutcome {
            app: Arc::clone(&web),
            status: AppStatus::Succeeded,
        });
        drop(recorder);

        let events: Vec<BatchEvent> = batch.output().collect().await;
        let BatchEvent::Skipped { events: missed } = events[0] else {
            panic!("the first event says what was missed: {:?}", events[0]);
        };

        // `Finished` took the room of one more line: the log holds the last lines, then it.
        assert_eq!(events.len(), 1 + (kept - 1) + 1);
        assert_eq!(missed, (1 + lines - (kept - 1)) as u64);
        assert!(matches!(events.last(), Some(BatchEvent::Finished(_))));
        assert!(batch.is_finished());
    }

    #[tokio::test]
    async fn counts_a_line_of_a_few_bytes_at_its_fixed_cost() {
        let web: Arc<str> = Arc::from("web");
        let (batch, recorder) = ComposeBatch::new(ComposeCommand::Pull, vec![Arc::clone(&web)]);
        let lines = Log::MAX_BYTES / Log::EVENT_BYTES;

        for _ in 0..2 * lines {
            recorder.line(&web, b"\n".to_vec());
        }

        let log = batch.shared.log();

        assert!(log.entries.len() < lines, "{}", log.entries.len());
        assert!(log.bytes <= Log::MAX_BYTES);
    }

    #[tokio::test]
    async fn gives_the_apps_with_no_outcome_as_not_run_once_the_recorder_is_dropped() {
        let web: Arc<str> = Arc::from("web");
        let db: Arc<str> = Arc::from("db");
        let (batch, recorder) = ComposeBatch::new(
            ComposeCommand::Down,
            vec![Arc::clone(&web), Arc::clone(&db)],
        );
        let output = batch.output();

        recorder.started(&web);
        drop(recorder);

        let events: Vec<String> = output
            .map(|event| match event {
                BatchEvent::Started { app } => format!("started {app}"),
                BatchEvent::Finished(outcome) => format!("{} {:?}", outcome.app, outcome.status),
                other => format!("{other:?}"),
            })
            .collect()
            .await;
        let report = batch.finished().await;

        assert_eq!(events, ["started web", "web NotRun", "db NotRun"]);
        assert_eq!(report.apps.len(), 2);
        assert_eq!(report.failures(), 2);
    }
}
