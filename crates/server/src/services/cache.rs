//! Values from the widgets' services, kept by key and loaded on demand: fresh for a while, then served stale while they
//! reload behind their reader, then awaited, and forgotten once too old to be served. Nothing is loaded without a
//! reader.

use std::collections::HashMap;
use std::fmt;
use std::hash::Hash;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::FutureExt;
use futures::future::{BoxFuture, Shared};
use tokio::time::Instant;

use super::clients::Clients;
use super::error::LoadError;
use super::{Locator, ServiceKey};
use crate::failure::Failure;

/// What a load gives: the value, or why it did not, shared by every reader that waited for it.
pub(crate) type Loaded<T> = Result<Arc<T>, Arc<LoadError>>;

/// A load in flight, which every reader that asks meanwhile shares.
type Loading<T> = Shared<BoxFuture<'static, Loaded<T>>>;

/// How long a value is used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Policy {
    /// How long it is served as it is once loaded.
    pub(crate) fresh: Duration,
    /// How long past `fresh` it is still served at once, while it reloads: past that, a reader waits for the reload.
    pub(crate) stale: Duration,
}

/// Values kept by key, as the call that loads them: a service and the parameters of its call. The readers of a key
/// share one load, which runs in a task of its own, so that a reader who leaves does not cancel it for the others. A
/// failed load is not kept; a failed reload keeps the last value, which ages on, so that a service that stopped
/// answering shows its failure once the value is too old.
///
/// An entry is forgotten once it would no longer be served at all, by the longest policy of its readers: its value is
/// older than `fresh` and `stale` together, 60 seconds and 15 minutes by default, and no load of it runs. A reader that came
/// then would wait for a load anyway, so forgetting it changes no answer, and the keys no reader asks for any more, as
/// those of a `hangar.yml` changed since, do not stay.
pub(crate) struct Kept<K, T> {
    /// What the values are, in the log.
    name: &'static str,
    entries: Mutex<Entries<K, T>>,
}

/// The entries, and the generation the next one takes.
struct Entries<K, T> {
    by_key: HashMap<K, Entry<T>>,
    next_generation: u64,
}

/// A key's value, and its load.
struct Entry<T> {
    /// Which entry of its key it is: one forgotten and made again is another, which the load of the first leaves
    /// alone.
    generation: u64,
    /// The last good value, and when it was loaded.
    value: Option<(Arc<T>, Instant)>,
    loading: Option<Loading<T>>,
    /// How long its value is served, `fresh` and `stale` together, by the longest policy of its readers: a reader of a
    /// short `ttl` does not forget it for one of a long one.
    served_for: Duration,
}

impl<T> Entry<T> {
    /// Whether it would still be served, or is loading.
    fn is_live(&self) -> bool {
        let is_served = self
            .value
            .as_ref()
            .is_some_and(|(_, loaded_at)| loaded_at.elapsed() < self.served_for);

        is_served || self.loading.is_some()
    }
}

impl<K, T> Kept<K, T>
where
    K: Clone + Eq + Hash + fmt::Debug + Send + Sync + 'static,
    T: Send + Sync + 'static,
{
    /// No value yet, of what the log calls `name`.
    pub(crate) fn new(name: &'static str) -> Arc<Self> {
        Arc::new(Self {
            name,
            entries: Mutex::new(Entries {
                by_key: HashMap::new(),
                next_generation: 0,
            }),
        })
    }

    /// The value of `key`, kept by `policy`: as kept while fresh, as kept with a reload by `load` behind it while
    /// stale, and once `load` has given it when there is none or it is too old. A load running already is joined, and
    /// `load` left uncalled.
    ///
    /// # Errors
    ///
    /// The error of the load awaited, when one was.
    pub(crate) async fn get<F>(
        self: &Arc<Self>,
        key: K,
        policy: Policy,
        load: impl FnOnce() -> F,
    ) -> Loaded<T>
    where
        F: Future<Output = Result<T, LoadError>> + Send + 'static,
    {
        let loading = {
            let mut entries = self.lock();
            let Entries {
                by_key,
                next_generation,
            } = &mut *entries;

            let served_for = policy.fresh + policy.stale;

            // This reader's policy counts before the others' entries are judged, its own among them.
            if let Some(entry) = by_key.get_mut(&key) {
                entry.served_for = entry.served_for.max(served_for);
            }

            by_key.retain(|_, entry| entry.is_live());

            let entry = by_key.entry(key.clone()).or_insert_with(|| {
                *next_generation += 1;

                Entry {
                    generation: *next_generation,
                    value: None,
                    loading: None,
                    served_for,
                }
            });

            if let Some((value, loaded_at)) = &entry.value {
                let age = loaded_at.elapsed();
                let value = Arc::clone(value);

                if age < policy.fresh {
                    return Ok(value);
                }

                if age < policy.fresh + policy.stale {
                    if entry.loading.is_none() {
                        // The load's own task drives it: the reader has its value already.
                        drop(self.start(entry, key, load()));
                    }

                    return Ok(value);
                }
            }

            match &entry.loading {
                Some(loading) => loading.clone(),
                None => self.start(entry, key, load()),
            }
        };

        loading.await
    }

    /// Forgets the values whose key `is_kept` refuses; their loads running end unheard.
    pub(crate) fn retain(&self, is_kept: impl Fn(&K) -> bool) {
        self.lock().by_key.retain(|key, _| is_kept(key));
    }

    /// Starts `load` as the load of `entry`, the entry of `key`, in a task of its own.
    fn start<F>(self: &Arc<Self>, entry: &mut Entry<T>, key: K, load: F) -> Loading<T>
    where
        F: Future<Output = Result<T, LoadError>> + Send + 'static,
    {
        let this = Arc::clone(self);
        let generation = entry.generation;
        let loading = async move {
            // A load that panics fails as any other, rather than leave its shared future to panic every reader.
            let loaded = match AssertUnwindSafe(load).catch_unwind().await {
                Ok(Ok(value)) => Ok(Arc::new(value)),
                Ok(Err(error)) => Err(Arc::new(error)),
                Err(_) => Err(Arc::new(LoadError::Panicked { name: this.name })),
            };

            this.finish(&key, generation, &loaded);

            loaded
        }
        .boxed()
        .shared();

        entry.loading = Some(loading.clone());
        tokio::spawn(loading.clone());

        loading
    }

    /// Keeps what the load of `key` gave, in the entry of `generation` it was started for: one forgotten meanwhile,
    /// and maybe made again, is left alone. A key whose first load failed is forgotten.
    fn finish(&self, key: &K, generation: u64, loaded: &Loaded<T>) {
        let mut entries = self.lock();
        let Some(entry) = entries
            .by_key
            .get_mut(key)
            .filter(|entry| entry.generation == generation)
        else {
            return;
        };

        entry.loading = None;

        match loaded {
            Ok(value) => entry.value = Some((Arc::clone(value), Instant::now())),
            Err(error) if entry.value.is_some() => tracing::warn!(
                value = self.name,
                ?key,
                error = %Failure::chain(&**error),
                "could not reload a value: the last one is kept"
            ),
            Err(_) => {
                entries.by_key.remove(key);
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Entries<K, T>> {
        self.entries
            .lock()
            .expect("no code panics while it holds the kept values")
    }
}

/// A part of a service: one call of it, kept by the service, as its declaration writes it, and the call's own
/// parameters, `Call`. The service is resolved and its client taken only when the call is made: a fresh value kept
/// reads neither the store nor `.env.global`.
///
/// It is kept by the declaration's policy: fresh for its `ttl`, else a minute. A service whose calls are limited is
/// asked less often by a longer `ttl`.
pub(crate) struct Part<Call, T> {
    kept: Arc<Kept<(ServiceKey, Call), T>>,
}

impl<Call, T> Part<Call, T>
where
    Call: Clone + Eq + Hash + fmt::Debug + Send + Sync + 'static,
    T: Clone + Send + Sync + 'static,
{
    /// No call kept yet, of what the log calls `name`.
    pub(crate) fn new(name: &'static str) -> Self {
        Self {
            kept: Kept::new(name),
        }
    }

    /// What `call` of the service `locator` finds gives, kept by its policy: made by `load` with the service's client,
    /// on a miss or a stale value.
    ///
    /// # Errors
    ///
    /// When the call was made, and the service could not be resolved, its client built, or `load` failed.
    pub(crate) async fn get<C, F>(
        &self,
        locator: &Locator,
        clients: &Arc<Clients<C>>,
        call: Call,
        load: impl FnOnce(C) -> F + Send + 'static,
    ) -> Result<T, Arc<LoadError>>
    where
        C: Clone + Send + Sync + 'static,
        F: Future<Output = Result<T, LoadError>> + Send + 'static,
    {
        let (owned, clients) = (locator.clone(), Arc::clone(clients));
        let value = self
            .kept
            .get(
                (locator.key(), call),
                locator.policy(),
                move || async move {
                    let client = clients.of(&owned).await?;

                    load(client).await
                },
            )
            .await?;

        Ok((*value).clone())
    }
}

/// Shows the name alone: the values may be large.
impl<Call, T> fmt::Debug for Part<Call, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Part").field("kept", &self.kept).finish()
    }
}

/// Shows the name alone: the values may be large.
impl<K, T> fmt::Debug for Kept<K, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Kept")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::sync::Semaphore;

    use super::*;

    /// Fresh for 10 s, then stale for 10 s more.
    const POLICY: Policy = Policy {
        fresh: Duration::from_secs(10),
        stale: Duration::from_secs(10),
    };

    /// A service that counts its loads, each giving its number, or failing once `fails` says.
    #[derive(Default)]
    struct Source {
        loads: AtomicUsize,
        fails: std::sync::atomic::AtomicBool,
        gate: Option<Arc<Semaphore>>,
    }

    impl Source {
        fn load(self: &Arc<Self>) -> impl FnOnce() -> BoxFuture<'static, Result<usize, LoadError>> {
            let this = Arc::clone(self);

            move || {
                async move {
                    // One permit per load: forgotten, it lets no other load through.
                    if let Some(gate) = &this.gate {
                        gate.acquire().await.expect("the gate stays open").forget();
                    }

                    let load = this.loads.fetch_add(1, Ordering::SeqCst) + 1;

                    if this.fails.load(Ordering::SeqCst) {
                        return Err(LoadError::refused("the service is gone"));
                    }

                    Ok(load)
                }
                .boxed()
            }
        }

        fn loads(&self) -> usize {
            self.loads.load(Ordering::SeqCst)
        }
    }

    async fn get(kept: &Arc<Kept<String, usize>>, source: &Arc<Source>) -> Result<usize, String> {
        kept.get("key".to_owned(), POLICY, source.load())
            .await
            .map(|value| *value)
            .map_err(|error| error.to_string())
    }

    /// Lets the tasks of the loads run to their end, time paused.
    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn serves_a_fresh_value_without_loading_it_again() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());

        assert_eq!(get(&kept, &source).await, Ok(1));
        tokio::time::advance(Duration::from_secs(9)).await;
        assert_eq!(get(&kept, &source).await, Ok(1));
        assert_eq!(source.loads(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn serves_a_stale_value_at_once_and_reloads_it_behind() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());

        get(&kept, &source).await.expect("loaded");
        tokio::time::advance(Duration::from_secs(11)).await;

        assert_eq!(get(&kept, &source).await, Ok(1), "the stale value, at once");
        settle().await;
        assert_eq!(get(&kept, &source).await, Ok(2), "the reloaded one");
        assert_eq!(source.loads(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn waits_for_the_load_once_the_value_is_too_old() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());

        get(&kept, &source).await.expect("loaded");
        tokio::time::advance(Duration::from_secs(21)).await;

        assert_eq!(get(&kept, &source).await, Ok(2));
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_the_last_value_through_a_failed_reload_until_it_is_too_old() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());

        get(&kept, &source).await.expect("loaded");
        source.fails.store(true, Ordering::SeqCst);
        tokio::time::advance(Duration::from_secs(11)).await;

        assert_eq!(get(&kept, &source).await, Ok(1));
        settle().await;
        assert_eq!(get(&kept, &source).await, Ok(1), "kept through the failure");

        tokio::time::advance(Duration::from_secs(10)).await;

        assert_eq!(
            get(&kept, &source).await,
            Err("the service is gone".to_owned())
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_no_failed_first_load() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());

        source.fails.store(true, Ordering::SeqCst);
        assert!(get(&kept, &source).await.is_err());

        source.fails.store(false, Ordering::SeqCst);
        assert_eq!(get(&kept, &source).await, Ok(2));
    }

    #[tokio::test(start_paused = true)]
    async fn shares_one_load_between_the_readers_of_a_key() {
        let kept = Kept::new("test");
        let gate = Arc::new(Semaphore::new(0));
        let source = Arc::new(Source {
            gate: Some(Arc::clone(&gate)),
            ..Source::default()
        });
        let first = tokio::spawn({
            let (kept, source) = (Arc::clone(&kept), Arc::clone(&source));

            async move { get(&kept, &source).await }
        });
        let second = tokio::spawn({
            let (kept, source) = (Arc::clone(&kept), Arc::clone(&source));

            async move { get(&kept, &source).await }
        });

        settle().await;
        gate.add_permits(2);

        assert_eq!(first.await.expect("no panic"), Ok(1));
        assert_eq!(second.await.expect("no panic"), Ok(1));
        assert_eq!(source.loads(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn ends_a_load_whose_reader_left() {
        let kept = Kept::new("test");
        let gate = Arc::new(Semaphore::new(0));
        let source = Arc::new(Source {
            gate: Some(Arc::clone(&gate)),
            ..Source::default()
        });

        let left = tokio::time::timeout(Duration::from_secs(1), get(&kept, &source)).await;

        assert!(left.is_err(), "the reader gave up");

        gate.add_permits(1);
        settle().await;

        assert_eq!(source.loads(), 1);
        assert_eq!(get(&kept, &source).await, Ok(1), "the load it started");
    }

    #[tokio::test(start_paused = true)]
    async fn leaves_alone_the_entry_made_again_after_the_one_a_load_was_for_was_forgotten() {
        let kept = Kept::new("test");
        let gate = Arc::new(Semaphore::new(0));
        let source = Arc::new(Source {
            gate: Some(Arc::clone(&gate)),
            ..Source::default()
        });
        let reader = |kept: &Arc<Kept<String, usize>>, source: &Arc<Source>| {
            let (kept, source) = (Arc::clone(kept), Arc::clone(source));

            tokio::spawn(async move { get(&kept, &source).await })
        };

        let first = reader(&kept, &source);

        settle().await;
        kept.retain(|_| false);

        let second = reader(&kept, &source);

        settle().await;
        // The first load ends: the entry the second made is not its own.
        gate.add_permits(1);
        assert_eq!(first.await.expect("no panic"), Ok(1));

        let third = reader(&kept, &source);

        settle().await;
        gate.add_permits(1);

        assert_eq!(second.await.expect("no panic"), Ok(2));
        assert_eq!(
            third.await.expect("no panic"),
            Ok(2),
            "it joined the second load"
        );
        assert_eq!(source.loads(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn forgets_an_entry_once_it_would_no_longer_be_served() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());
        let other = Arc::new(Source::default());

        get(&kept, &source).await.expect("loaded");
        tokio::time::advance(Duration::from_secs(19)).await;
        kept.get("other".to_owned(), POLICY, other.load())
            .await
            .expect("loaded");
        assert_eq!(kept.lock().by_key.len(), 2, "still served, stale");

        tokio::time::advance(Duration::from_secs(1)).await;
        kept.get("other".to_owned(), POLICY, other.load())
            .await
            .expect("fresh");

        assert_eq!(
            kept.lock().by_key.keys().collect::<Vec<_>>(),
            ["other"],
            "unread for fresh and stale together, it is gone"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_an_entry_for_the_longest_policy_of_its_readers() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());
        let other = Arc::new(Source::default());
        let long = Policy {
            fresh: Duration::from_secs(10),
            stale: Duration::from_secs(100),
        };

        kept.get("key".to_owned(), long, source.load())
            .await
            .expect("loaded");
        get(&kept, &source).await.expect("kept");
        tokio::time::advance(Duration::from_secs(25)).await;
        kept.get("other".to_owned(), POLICY, other.load())
            .await
            .expect("loaded");

        assert_eq!(
            kept.get("key".to_owned(), long, source.load())
                .await
                .map(|value| *value)
                .map_err(|error| error.to_string()),
            Ok(1),
            "still served stale to the reader of the long policy, past the short one's"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_an_entry_whose_load_runs_past_its_policy() {
        let kept = Kept::new("test");
        let gate = Arc::new(Semaphore::new(0));
        let source = Arc::new(Source {
            gate: Some(Arc::clone(&gate)),
            ..Source::default()
        });
        let other = Arc::new(Source::default());
        let reader = tokio::spawn({
            let (kept, source) = (Arc::clone(&kept), Arc::clone(&source));

            async move { get(&kept, &source).await }
        });

        settle().await;
        tokio::time::advance(Duration::from_secs(30)).await;
        kept.get("other".to_owned(), POLICY, other.load())
            .await
            .expect("loaded");
        gate.add_permits(1);

        assert_eq!(reader.await.expect("no panic"), Ok(1));
        assert_eq!(get(&kept, &source).await, Ok(1), "kept by its load");
    }

    #[tokio::test(start_paused = true)]
    async fn forgets_the_values_it_is_told_to() {
        let kept = Kept::new("test");
        let source = Arc::new(Source::default());

        get(&kept, &source).await.expect("loaded");
        kept.retain(|key| key != "key");

        assert_eq!(get(&kept, &source).await, Ok(2));
    }
}
