//! The gate between the store's changes and its sync: a save of `hangar.yml` during a pull could fail the pull or be
//! lost, and an install racing the links of a sync could fail though it installed.

use std::sync::{Mutex, PoisonError};

use tokio::sync::{MutexGuard, Notify};

/// Lets the changes of the store in one at a time, and none while a sync runs; a sync waits for the changes in.
///
/// Whether a sync runs and how many changes are in are kept together, so that the two never disagree: a change that
/// is in, waiting its turn or making its change, is one the sync waits for; once the sync is marked, none gets in.
/// A change then never waits for the network, and the sync waits for changes alone, which are short.
#[derive(Debug, Default)]
pub(crate) struct ChangeGate {
    state: Mutex<GateState>,
    /// Wakes a sync waiting for the changes in, once the last one leaves.
    idle: Notify,
    /// The changes among themselves, one at a time.
    turn: tokio::sync::Mutex<()>,
}

/// What the gate knows.
#[derive(Debug, Default)]
struct GateState {
    /// Whether a sync runs.
    syncing: bool,
    /// The changes in: waiting their turn, or making their change.
    changes: usize,
}

/// A change of the store, in the gate until dropped.
#[derive(Debug)]
pub(crate) struct Change<'a> {
    _turn: MutexGuard<'a, ()>,
    _entry: Entry<'a>,
}

/// A change counted in the gate, until dropped.
#[derive(Debug)]
struct Entry<'a>(&'a ChangeGate);

impl ChangeGate {
    /// Lets a change in, once the changes in before it are done; `None` while a sync runs, which it never waits for.
    pub(crate) async fn enter(&self) -> Option<Change<'_>> {
        {
            let mut state = self.state();

            if state.syncing {
                return None;
            }

            state.changes += 1;
        }

        let entry = Entry(self);
        let turn = self.turn.lock().await;

        Some(Change {
            _turn: turn,
            _entry: entry,
        })
    }

    /// Whether a sync runs.
    pub(crate) fn is_syncing(&self) -> bool {
        self.state().syncing
    }

    /// Marks a sync running, unless one runs, and calls `publish` meanwhile, so that what it publishes and the gate
    /// agree; `false`, and nothing published, when one runs. No change gets in from then on.
    pub(crate) fn begin_sync(&self, publish: impl FnOnce()) -> bool {
        let mut state = self.state();

        if state.syncing {
            return false;
        }

        state.syncing = true;
        publish();

        true
    }

    /// Marks the sync ended, and calls `publish` meanwhile.
    pub(crate) fn end_sync(&self, publish: impl FnOnce()) {
        let mut state = self.state();

        state.syncing = false;
        publish();
    }

    /// Resolves once no change is in: for a sync, once marked, whose changes in before it are then the last.
    pub(crate) async fn changes_ended(&self) {
        loop {
            let notified = self.idle.notified();
            let mut notified = std::pin::pin!(notified);

            // Registered before the count is read, so that a change leaving in between is not missed.
            notified.as_mut().enable();

            if self.state().changes == 0 {
                return;
            }

            notified.await;
        }
    }

    /// The state, whatever a panic left it: it holds two plain values, each written whole.
    fn state(&self) -> std::sync::MutexGuard<'_, GateState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Drop for Entry<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state();

        state.changes -= 1;

        if state.changes == 0 {
            self.0.idle.notify_waiters();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::pin::pin;

    use futures::FutureExt;
    use futures::poll;

    use super::ChangeGate;

    #[tokio::test]
    async fn lets_one_change_in_at_a_time_and_none_while_a_sync_runs() {
        let gate = ChangeGate::default();
        let first = gate.enter().await.expect("no sync runs");
        let mut second = pin!(gate.enter());

        assert!(
            poll!(second.as_mut()).is_pending(),
            "the second waits its turn"
        );

        drop(first);

        let second = second.await.expect("its turn");

        drop(second);

        assert!(gate.begin_sync(|| {}));
        assert!(!gate.begin_sync(|| {}), "one sync at a time");
        assert!(gate.enter().await.is_none(), "refused while a sync runs");

        gate.end_sync(|| {});

        assert!(gate.enter().await.is_some());
    }

    #[tokio::test]
    async fn a_sync_waits_for_every_change_in_before_it_even_one_waiting_its_turn() {
        let gate = ChangeGate::default();
        let first = gate.enter().await.expect("no sync runs");
        let mut waiting = pin!(gate.enter());

        assert!(poll!(waiting.as_mut()).is_pending(), "in, waiting its turn");
        assert!(gate.begin_sync(|| {}));

        let mut ended = pin!(gate.changes_ended());

        assert!(
            ended.as_mut().now_or_never().is_none(),
            "two changes are in"
        );

        drop(first);

        let waiting = waiting.await.expect("it was in before the sync");

        assert!(
            ended.as_mut().now_or_never().is_none(),
            "the one that waited its turn is still in"
        );

        drop(waiting);
        ended.await;
    }
}
