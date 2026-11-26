//! A value read from the daemon, kept and reloaded behind its readers: fresh for a while, then served stale while it
//! reloads, then awaited; after a failed load, not read again for a while that grows.

use std::fmt;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::FutureExt;
use futures::future::{BoxFuture, Shared};
use hangar_core::DockerError;
use tokio::time::Instant;

use crate::failure::Failure;

/// What a load gives: the value, or why it did not, shared by every reader that waited for it.
pub(crate) type Loaded<T> = Result<Arc<T>, Arc<LoadError>>;

/// Why a load gave no value.
#[derive(Debug, thiserror::Error)]
pub(crate) enum LoadError {
    /// The daemon did not answer, or answered with an error.
    #[error(transparent)]
    Docker(#[from] DockerError),
    /// The load panicked: a bug, which the next load may not meet.
    #[error("the read of the {value} panicked")]
    Panicked {
        /// What was read.
        value: &'static str,
    },
}

/// A load in flight, which every reader that asks meanwhile shares.
type Loading<T> = Shared<BoxFuture<'static, Loaded<T>>>;

/// How a value is read from the daemon.
type Load<T> = Box<dyn Fn() -> BoxFuture<'static, Result<T, DockerError>> + Send + Sync>;

/// How long a value is used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Policy {
    /// How long it is served as it is once loaded.
    pub(crate) fresh: Duration,
    /// How long past `fresh` it is still served at once, while it reloads: past that, a reader waits for the reload.
    pub(crate) stale: Duration,
}

/// A value of the daemon, kept: its reads share one load, a failed load is never kept, and a failed reload keeps the
/// last good value, served until it is too old. After a failure, the daemon is not asked again before a wait, from 2
/// seconds, doubled by each failure up to a minute: meanwhile a read gets the last value while it may be served, the
/// error otherwise. The daemon's events [`refresh`](Self::refresh) it, whatever the wait, as an event means the daemon
/// answers; its policy is the net for a change they missed, as while they are followed again.
pub(crate) struct Cached<T> {
    /// What the value is, in the log.
    name: &'static str,
    policy: Policy,
    load: Load<T>,
    /// Called once a reload gave a value other than the one it replaces.
    on_change: Box<dyn Fn() + Send + Sync>,
    state: Mutex<State<T>>,
}

/// Where a value is.
struct State<T> {
    /// The last good value, and when it was loaded.
    value: Option<(Arc<T>, Instant)>,
    loading: Option<Loading<T>>,
    /// Set by a refresh while a load runs, which may have read the daemon before the change: one more load follows it.
    is_queued: bool,
    /// The last load, when it failed.
    failure: Option<LoadFailure>,
}

/// A load that failed, and when the next may start.
struct LoadFailure {
    error: Arc<LoadError>,
    /// How long the daemon is left alone after it.
    wait: Duration,
    retry_at: Instant,
}

impl<T: PartialEq + Send + Sync + 'static> Cached<T> {
    /// The wait after a first failure.
    const FIRST_WAIT: Duration = Duration::from_secs(2);

    /// The longest wait, after many failures.
    const LONGEST_WAIT: Duration = Duration::from_secs(60);

    /// A value called `name` in the log, kept by `policy`, read by `load`; `on_change` is called once a reload changes
    /// it.
    pub(crate) fn new<L, F>(
        name: &'static str,
        policy: Policy,
        load: L,
        on_change: impl Fn() + Send + Sync + 'static,
    ) -> Arc<Self>
    where
        L: Fn() -> F + Send + Sync + 'static,
        F: Future<Output = Result<T, DockerError>> + Send + 'static,
    {
        Arc::new(Self {
            name,
            policy,
            load: Box::new(move || load().boxed()),
            on_change: Box::new(on_change),
            state: Mutex::new(State {
                value: None,
                loading: None,
                is_queued: false,
                failure: None,
            }),
        })
    }

    /// The value: as kept while fresh, as kept with a reload behind it while stale, and once loaded when there is none
    /// or it is too old. While the wait after a failure runs, no load starts: the value is served while it may be, and
    /// the failure otherwise.
    ///
    /// # Errors
    ///
    /// The error of the load awaited, when one was, or of the last load, while its wait runs.
    pub(crate) async fn get(self: &Arc<Self>) -> Loaded<T> {
        let loading = {
            let mut state = self.lock();
            let waiting = match &state.failure {
                Some(failure) if state.loading.is_none() && Instant::now() < failure.retry_at => {
                    Some(Arc::clone(&failure.error))
                }
                _ => None,
            };

            if let Some((value, loaded_at)) = &state.value {
                let age = loaded_at.elapsed();
                let value = Arc::clone(value);

                if age < self.policy.fresh {
                    return Ok(value);
                }

                if age < self.policy.fresh + self.policy.stale {
                    if waiting.is_none() {
                        self.start(&mut state);
                    }

                    return Ok(value);
                }
            }

            if let Some(error) = waiting {
                return Err(error);
            }

            self.loading(&mut state)
        };

        loading.await
    }

    /// Reloads the value, for a caller that learnt it changed: readers keep the current one meanwhile. A value never
    /// asked for is left alone, as nobody waits for it; one whose first read failed is not, as its page shows that
    /// failure.
    pub(crate) fn refresh(self: &Arc<Self>) {
        let mut state = self.lock();

        if state.loading.is_some() {
            state.is_queued = true;

            return;
        }

        if state.value.is_some() || state.failure.is_some() {
            self.start(&mut state);
        }
    }

    /// Refreshes the value every time it goes stale, from now until the server stops, for a caller that can no longer
    /// learn it changed, as when the daemon refuses its events: a page then learns of a change late, but learns of it.
    pub(crate) fn poll(self: &Arc<Self>) {
        let this = Arc::clone(self);

        tokio::spawn(async move {
            let mut ticks = tokio::time::interval(this.policy.fresh);

            loop {
                ticks.tick().await;
                this.refresh();
            }
        });
    }

    /// Starts a load, unless one runs.
    fn start(self: &Arc<Self>, state: &mut State<T>) {
        // The load's own task drives it: nobody needs to await it.
        drop(self.loading(state));
    }

    /// The load running, or one started, which a task of its own drives whether a reader awaits it or not.
    fn loading(self: &Arc<Self>, state: &mut State<T>) -> Loading<T> {
        if let Some(loading) = &state.loading {
            return loading.clone();
        }

        let this = Arc::clone(self);
        let loading = async move {
            // A load that panics fails as any other, rather than leave its shared future to panic every later read.
            let loaded = match AssertUnwindSafe(async { (this.load)().await })
                .catch_unwind()
                .await
            {
                Ok(Ok(value)) => Ok(Arc::new(value)),
                Ok(Err(error)) => Err(Arc::new(LoadError::Docker(error))),
                Err(_) => Err(Arc::new(LoadError::Panicked { value: this.name })),
            };

            this.finish(&loaded);

            loaded
        }
        .boxed()
        .shared();

        state.loading = Some(loading.clone());
        tokio::spawn(loading.clone());

        loading
    }

    /// Keeps what a load gave, or the failure and the wait it starts, and starts the load a refresh queued meanwhile. A
    /// failed load is tried again once its wait has passed, as nothing else may ask for it: the event that made the
    /// value stale has come and gone, and the pages read again only once the value changes, or a first one comes.
    fn finish(self: &Arc<Self>, loaded: &Loaded<T>) {
        let (has_changed, retry_at) = {
            let mut state = self.lock();
            let mut retry_at = None;
            let has_changed = match loaded {
                Ok(value) => {
                    // A first value after a failed read changes what the pages show too: their failure.
                    let has_changed = match &state.value {
                        Some((previous, _)) => previous != value,
                        None => state.failure.is_some(),
                    };

                    state.value = Some((Arc::clone(value), Instant::now()));
                    state.failure = None;

                    has_changed
                }
                Err(error) => {
                    let wait = state.failure.as_ref().map_or(Self::FIRST_WAIT, |failure| {
                        (failure.wait * 2).min(Self::LONGEST_WAIT)
                    });

                    if state.value.is_some() {
                        tracing::warn!(
                            value = self.name,
                            error = %Failure::chain(&**error),
                            ?wait,
                            "could not reload a value of the Docker daemon: the last one is kept"
                        );
                    }

                    let at = Instant::now() + wait;

                    retry_at = Some(at);
                    state.failure = Some(LoadFailure {
                        error: Arc::clone(error),
                        wait,
                        retry_at: at,
                    });

                    false
                }
            };

            state.loading = None;

            if std::mem::take(&mut state.is_queued) {
                self.start(&mut state);
            }

            (has_changed, retry_at)
        };

        if has_changed {
            (self.on_change)();
        }

        if let Some(at) = retry_at {
            let this = Arc::clone(self);

            tokio::spawn(async move {
                tokio::time::sleep_until(at).await;
                this.retry(at);
            });
        }
    }

    /// Reloads the value after the failure whose wait ended `at`, unless a load ran since: one that succeeded, or one
    /// that failed and is tried again after a wait of its own.
    fn retry(self: &Arc<Self>, at: Instant) {
        let mut state = self.lock();
        let is_same_failure = state
            .failure
            .as_ref()
            .is_some_and(|failure| failure.retry_at == at);

        if is_same_failure {
            self.start(&mut state);
        }
    }

    /// Once no load runs, those a refresh queued included.
    #[cfg(test)]
    pub(crate) async fn settled(&self) {
        loop {
            let loading = self.lock().loading.clone();

            let Some(loading) = loading else {
                return;
            };

            let _ = loading.await;
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State<T>> {
        self.state
            .lock()
            .expect("no code panics while it holds the state of a cached value")
    }
}

/// Shows the name alone: the value may be large.
impl<T> fmt::Debug for Cached<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cached")
            .field("name", &self.name)
            .field("policy", &self.policy)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::sync::Semaphore;

    use super::*;

    /// What a load of the test's daemon does.
    enum Answer {
        Gives(u32),
        Fails,
        Panics,
    }

    /// A daemon whose answers the test writes, each load given its own once the gate lets it through.
    struct Source {
        loads: AtomicUsize,
        changes: AtomicUsize,
        answers: Mutex<VecDeque<Answer>>,
        gate: Semaphore,
    }

    impl Source {
        /// The source of `answers`, its gate open for `permits` loads; once they run out, a load fails.
        fn new(answers: impl IntoIterator<Item = Answer>, permits: usize) -> Arc<Self> {
            Arc::new(Self {
                loads: AtomicUsize::new(0),
                changes: AtomicUsize::new(0),
                answers: Mutex::new(answers.into_iter().collect()),
                gate: Semaphore::new(permits),
            })
        }

        /// A value of this source, fresh for 10 s, then stale for 10 s more.
        fn cached(self: &Arc<Self>) -> Arc<Cached<u32>> {
            let loading = Arc::clone(self);
            let changing = Arc::clone(self);

            Cached::new(
                "test",
                Policy {
                    fresh: Duration::from_secs(10),
                    stale: Duration::from_secs(10),
                },
                move || {
                    let source = Arc::clone(&loading);

                    async move {
                        source.loads.fetch_add(1, Ordering::SeqCst);
                        source
                            .gate
                            .acquire()
                            .await
                            .expect("the gate stays")
                            .forget();

                        let answer = source
                            .answers
                            .lock()
                            .expect("no test panics with the answers")
                            .pop_front();

                        match answer {
                            Some(Answer::Gives(value)) => Ok(value),
                            Some(Answer::Panics) => panic!("the load panics, as the test asks"),
                            Some(Answer::Fails) | None => Err(DockerError::NotFound {
                                subject: "the daemon".to_owned(),
                            }),
                        }
                    }
                },
                move || {
                    changing.changes.fetch_add(1, Ordering::SeqCst);
                },
            )
        }

        fn loads(&self) -> usize {
            self.loads.load(Ordering::SeqCst)
        }

        fn changes(&self) -> usize {
            self.changes.load(Ordering::SeqCst)
        }
    }

    /// Enough permits for every load of a test.
    const OPEN: usize = 1_000;

    async fn value(cached: &Arc<Cached<u32>>) -> u32 {
        *cached.get().await.expect("a value")
    }

    #[tokio::test(start_paused = true)]
    async fn shares_one_load_between_its_readers_and_keeps_the_value_while_fresh() {
        let source = Source::new([Answer::Gives(1)], OPEN);
        let cached = source.cached();

        let (first, second) = tokio::join!(value(&cached), value(&cached));

        tokio::time::advance(Duration::from_secs(9)).await;

        assert_eq!((first, second, value(&cached).await), (1, 1, 1));
        assert_eq!(source.loads(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn serves_a_stale_value_at_once_while_it_reloads_then_the_new_one() {
        let source = Source::new([Answer::Gives(1), Answer::Gives(2)], 1);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        tokio::time::advance(Duration::from_secs(11)).await;

        assert_eq!(value(&cached).await, 1, "the reload waits at the gate");

        source.gate.add_permits(1);
        cached.settled().await;

        assert_eq!(value(&cached).await, 2);
        assert_eq!((source.loads(), source.changes()), (2, 1));
    }

    #[tokio::test(start_paused = true)]
    async fn waits_for_the_reload_of_a_value_too_old_to_serve() {
        let source = Source::new([Answer::Gives(1), Answer::Gives(2)], OPEN);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        tokio::time::advance(Duration::from_secs(21)).await;

        assert_eq!(value(&cached).await, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_no_failed_load_and_loads_again_once_its_wait_has_passed() {
        let source = Source::new([Answer::Fails, Answer::Gives(1)], OPEN);
        let cached = source.cached();

        assert!(cached.get().await.is_err());
        assert!(
            cached.get().await.is_err(),
            "the failure, while its wait runs"
        );
        assert_eq!(source.loads(), 1);

        tokio::time::advance(Duration::from_secs(2)).await;

        assert_eq!(value(&cached).await, 1);
        assert_eq!(source.loads(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_the_last_value_when_a_reload_fails() {
        let source = Source::new([Answer::Gives(1), Answer::Fails], OPEN);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        tokio::time::advance(Duration::from_secs(11)).await;

        assert_eq!(value(&cached).await, 1);

        cached.settled().await;

        assert_eq!(source.loads(), 2);
        assert_eq!(value(&cached).await, 1, "the reload failed");
    }

    #[tokio::test(start_paused = true)]
    async fn asks_a_failing_daemon_again_after_a_wait_that_doubles() {
        let source = Source::new(
            [
                Answer::Gives(1),
                Answer::Fails,
                Answer::Fails,
                Answer::Gives(2),
            ],
            OPEN,
        );
        let cached = source.cached();
        let read_after = async |wait: u64| {
            tokio::time::advance(Duration::from_secs(wait)).await;

            let value = value(&cached).await;

            cached.settled().await;

            (value, source.loads())
        };

        assert_eq!(read_after(0).await, (1, 1));
        assert_eq!(read_after(11).await, (1, 2), "stale: reloaded, and failed");
        assert_eq!(read_after(1).await, (1, 2), "within the first wait, 2 s");
        assert_eq!(
            read_after(1).await,
            (1, 3),
            "after it: reloaded, and failed again"
        );
        assert_eq!(read_after(3).await, (1, 3), "within the second wait, 4 s");
        assert_eq!(read_after(1).await, (1, 4), "after it: reloaded");
        assert_eq!(read_after(0).await, (2, 4));
    }

    #[tokio::test(start_paused = true)]
    async fn tries_a_failed_reload_again_once_its_wait_has_passed_unasked() {
        let source = Source::new([Answer::Gives(1), Answer::Fails, Answer::Gives(2)], OPEN);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        cached.refresh();
        cached.settled().await;

        assert_eq!(source.loads(), 2, "the reload an event asked for failed");

        tokio::time::advance(Duration::from_secs(2)).await;

        // The retry's task runs once the clock moved: it is awaited, never slept for.
        while source.loads() < 3 {
            tokio::task::yield_now().await;
        }

        cached.settled().await;

        assert_eq!((value(&cached).await, source.changes()), (2, 1));
    }

    #[tokio::test(start_paused = true)]
    async fn polled_reloads_the_value_each_time_it_goes_stale() {
        let source = Source::new([Answer::Gives(1), Answer::Gives(1), Answer::Gives(2)], OPEN);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        cached.poll();

        for loads in 2..=3 {
            // The poll's task runs once the clock moved: it is awaited, never slept for.
            while source.loads() < loads {
                tokio::task::yield_now().await;
            }

            cached.settled().await;
            tokio::time::advance(Duration::from_secs(10)).await;
        }

        assert_eq!((value(&cached).await, source.changes()), (2, 1));
    }

    #[tokio::test(start_paused = true)]
    async fn reloads_a_value_whose_first_read_failed_and_tells_of_it() {
        let source = Source::new([Answer::Fails, Answer::Gives(1)], OPEN);
        let cached = source.cached();

        assert!(cached.get().await.is_err());

        cached.refresh();
        cached.settled().await;

        assert_eq!(
            (source.loads(), source.changes()),
            (2, 1),
            "the refresh read it, whatever the wait"
        );
        assert_eq!(value(&cached).await, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn tries_a_failed_first_read_again_once_its_wait_has_passed_unasked() {
        let source = Source::new([Answer::Fails, Answer::Gives(1)], OPEN);
        let cached = source.cached();

        assert!(cached.get().await.is_err());

        tokio::time::advance(Duration::from_secs(2)).await;

        // The retry's task runs once the clock moved: it is awaited, never slept for.
        while source.loads() < 2 {
            tokio::task::yield_now().await;
        }

        cached.settled().await;

        assert_eq!((value(&cached).await, source.changes()), (1, 1));
    }

    #[tokio::test(start_paused = true)]
    async fn fails_a_load_that_panics_and_loads_again_after_it() {
        let source = Source::new([Answer::Panics, Answer::Gives(1)], OPEN);
        let cached = source.cached();

        let error = cached.get().await.expect_err("the load panicked");

        assert!(
            matches!(*error, LoadError::Panicked { value: "test" }),
            "{error}"
        );

        tokio::time::advance(Duration::from_secs(2)).await;

        assert_eq!(value(&cached).await, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn reloads_once_more_after_a_load_a_refresh_came_during() {
        let source = Source::new([Answer::Gives(1), Answer::Gives(2), Answer::Gives(3)], 1);
        let cached = source.cached();

        cached.refresh();

        assert_eq!(source.loads(), 0, "a value never read is left alone");
        assert_eq!(value(&cached).await, 1);

        cached.refresh();
        cached.refresh();
        source.gate.add_permits(2);
        cached.settled().await;

        assert_eq!(value(&cached).await, 3);
        assert_eq!((source.loads(), source.changes()), (3, 2));
    }

    #[tokio::test(start_paused = true)]
    async fn tells_of_a_change_only_when_a_reload_gives_another_value() {
        let source = Source::new([Answer::Gives(1), Answer::Gives(1), Answer::Gives(2)], OPEN);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        cached.refresh();
        cached.settled().await;

        assert_eq!(source.changes(), 0);

        cached.refresh();
        cached.settled().await;

        assert_eq!(source.changes(), 1);
    }
}
