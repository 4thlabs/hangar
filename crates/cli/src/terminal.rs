//! Whose the terminal's Ctrl-C is: the binary's, or that of a child it handed the terminal to.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// Whether a child holds the terminal, as a compose command passed through on one app: Ctrl-C is then the child's, as
/// with compose run by hand, and the binary leaves it alone. Its clones share it.
#[derive(Debug, Clone, Default)]
pub(crate) struct Terminal {
    is_handed_over: Arc<AtomicBool>,
}

/// Takes the terminal back when it is dropped, at the end of the run or when the run is dropped.
struct Handover<'a> {
    terminal: &'a Terminal,
}

impl Terminal {
    /// Runs `run`, a child that inherits the terminal, with the terminal handed over to it.
    pub(crate) async fn hand_over<T>(&self, run: impl Future<Output = T>) -> T {
        self.is_handed_over.store(true, Ordering::SeqCst);

        let _handover = Handover { terminal: self };

        run.await
    }

    /// Whether a child holds the terminal.
    pub(crate) fn is_handed_over(&self) -> bool {
        self.is_handed_over.load(Ordering::SeqCst)
    }
}

impl Drop for Handover<'_> {
    fn drop(&mut self) {
        self.terminal.is_handed_over.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::Terminal;

    #[tokio::test]
    async fn is_handed_over_for_the_run_alone() {
        let terminal = Terminal::default();
        let during = terminal
            .hand_over(async { terminal.is_handed_over() })
            .await;

        assert!(during);
        assert!(!terminal.is_handed_over());
    }
}
