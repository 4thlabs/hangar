//! A value read from the daemon, kept and reloaded behind its readers: fresh for a while, then served stale while it
//! reloads, then awaited.

use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::FutureExt;
use futures::future::{BoxFuture, Shared};
use hangar_core::DockerError;
use tokio::time::Instant;

use crate::failure::Failure;

/// What a load gives: the value, or why the daemon did not give it, shared by every reader that waited for it.
pub(crate) type Loaded<T> = Result<Arc<T>, Arc<DockerError>>;

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
/// last good value, served until it is too old. The daemon's events [`refresh`](Self::refresh) it; its policy is the
/// net for a change they missed, as while they are followed again.
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
}

impl<T: PartialEq + Send + Sync + 'static> Cached<T> {
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
            }),
        })
    }

    /// The value: as kept while fresh, as kept with a reload behind it while stale, and once loaded when there is none
    /// or it is too old.
    ///
    /// # Errors
    ///
    /// The error of the load awaited, when one was.
    pub(crate) async fn get(self: &Arc<Self>) -> Loaded<T> {
        let loading = {
            let mut state = self.lock();

            if let Some((value, loaded_at)) = &state.value {
                let age = loaded_at.elapsed();
                let value = Arc::clone(value);

                if age < self.policy.fresh {
                    return Ok(value);
                }

                if age < self.policy.fresh + self.policy.stale {
                    self.start(&mut state);

                    return Ok(value);
                }
            }

            self.loading(&mut state)
        };

        loading.await
    }

    /// Reloads the value, for a caller that learnt it changed: readers keep the current one meanwhile. A value never
    /// read is left alone, as nobody waits for it.
    pub(crate) fn refresh(self: &Arc<Self>) {
        let mut state = self.lock();

        if state.loading.is_some() {
            state.is_queued = true;

            return;
        }

        if state.value.is_some() {
            self.start(&mut state);
        }
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
        let load = (self.load)();
        let loading = async move {
            let loaded = load.await.map(Arc::new).map_err(Arc::new);

            this.finish(&loaded);

            loaded
        }
        .boxed()
        .shared();

        state.loading = Some(loading.clone());
        tokio::spawn(loading.clone());

        loading
    }

    /// Keeps what a load gave, and starts the one a refresh queued meanwhile.
    fn finish(self: &Arc<Self>, loaded: &Loaded<T>) {
        let has_changed = {
            let mut state = self.lock();
            let has_changed = match loaded {
                Ok(value) => {
                    let has_changed = state
                        .value
                        .as_ref()
                        .is_some_and(|(previous, _)| previous != value);

                    state.value = Some((Arc::clone(value), Instant::now()));

                    has_changed
                }
                Err(error) => {
                    if state.value.is_some() {
                        tracing::warn!(
                            value = self.name,
                            error = %Failure::chain(&**error),
                            "could not reload a value of the Docker daemon: the last one is kept"
                        );
                    }

                    false
                }
            };

            state.loading = None;

            if std::mem::take(&mut state.is_queued) {
                self.start(&mut state);
            }

            has_changed
        };

        if has_changed {
            (self.on_change)();
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

    /// A daemon whose answers the test writes, each load given its own once the gate lets it through.
    struct Source {
        loads: AtomicUsize,
        changes: AtomicUsize,
        answers: Mutex<VecDeque<Result<u32, DockerError>>>,
        gate: Semaphore,
    }

    impl Source {
        /// The source of `answers`, its gate open for `permits` loads; once they run out, a load fails.
        fn new(
            answers: impl IntoIterator<Item = Result<u32, DockerError>>,
            permits: usize,
        ) -> Arc<Self> {
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

                        answer.unwrap_or_else(|| Err(failure()))
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

    fn failure() -> DockerError {
        DockerError::NotFound {
            subject: "the daemon".to_owned(),
        }
    }

    async fn value(cached: &Arc<Cached<u32>>) -> u32 {
        *cached.get().await.expect("a value")
    }

    #[tokio::test(start_paused = true)]
    async fn shares_one_load_between_its_readers_and_keeps_the_value_while_fresh() {
        let source = Source::new([Ok(1)], usize::MAX >> 4);
        let cached = source.cached();

        let (first, second) = tokio::join!(value(&cached), value(&cached));

        tokio::time::advance(Duration::from_secs(9)).await;

        assert_eq!((first, second, value(&cached).await), (1, 1, 1));
        assert_eq!(source.loads(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn serves_a_stale_value_at_once_while_it_reloads_then_the_new_one() {
        let source = Source::new([Ok(1), Ok(2)], 1);
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
        let source = Source::new([Ok(1), Ok(2)], 2);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        tokio::time::advance(Duration::from_secs(21)).await;

        assert_eq!(value(&cached).await, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_no_failed_load() {
        let source = Source::new([Err(failure()), Ok(1)], 2);
        let cached = source.cached();

        assert!(cached.get().await.is_err());
        assert_eq!(value(&cached).await, 1);
        assert_eq!(source.loads(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_the_last_value_when_a_reload_fails() {
        let source = Source::new([Ok(1), Err(failure())], 3);
        let cached = source.cached();

        assert_eq!(value(&cached).await, 1);

        tokio::time::advance(Duration::from_secs(11)).await;

        assert_eq!(value(&cached).await, 1);

        cached.settled().await;

        assert_eq!(source.loads(), 2);
        assert_eq!(value(&cached).await, 1, "the reload failed");
    }

    #[tokio::test(start_paused = true)]
    async fn reloads_once_more_after_a_load_a_refresh_came_during() {
        let source = Source::new([Ok(1), Ok(2), Ok(3)], 1);
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
        let source = Source::new([Ok(1), Ok(1), Ok(2)], 3);
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
