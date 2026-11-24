//! The children a runtime has running, and whether it still starts new ones.

use std::sync::Arc;

use tokio::sync::watch;

/// The children of a runtime, its clones included: how many run, and whether it was interrupted. Both sit under one
/// lock, so that a run counted before an interruption is waited for, and one counted after is refused.
#[derive(Debug)]
pub(super) struct Children {
    state: watch::Sender<State>,
}

/// What [`Children`] holds.
#[derive(Debug, Default)]
struct State {
    interrupted: bool,
    running: usize,
}

impl Children {
    /// No child yet, and not interrupted.
    pub(super) fn new() -> Self {
        Self {
            state: watch::Sender::new(State::default()),
        }
    }

    /// Counts a child about to start, which stays counted until the [`Counted`] is dropped; `None` once interrupted.
    pub(super) fn enter(self: &Arc<Self>) -> Option<Counted> {
        let is_counted = self.state.send_if_modified(|state| {
            if state.interrupted {
                return false;
            }

            state.running += 1;

            true
        });

        is_counted.then(|| Counted(Arc::clone(self)))
    }

    /// Refuses the children to come.
    pub(super) fn interrupt(&self) {
        self.state.send_modify(|state| state.interrupted = true);
    }

    /// Resolves once no child is running.
    pub(super) async fn idle(&self) {
        self.state
            .subscribe()
            .wait_for(|state| state.running == 0)
            .await
            .expect("the children hold their sender while they are borrowed");
    }
}

/// One child counted in [`Children`], until it is dropped.
#[derive(Debug)]
pub(super) struct Counted(Arc<Children>);

impl Drop for Counted {
    fn drop(&mut self) {
        self.0.state.send_modify(|state| state.running -= 1);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::Children;

    #[tokio::test]
    async fn waits_for_a_child_counted_before_the_interruption_and_refuses_the_next() {
        let children = Arc::new(Children::new());
        let counted = children.enter().expect("not interrupted yet");

        children.interrupt();

        assert!(children.enter().is_none());

        let idle = children.idle();

        tokio::pin!(idle);

        assert!(
            tokio::time::timeout(Duration::ZERO, &mut idle)
                .await
                .is_err(),
            "a child is still counted"
        );

        drop(counted);
        idle.await;
    }
}
