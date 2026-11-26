//! Whose the terminal's Ctrl-C is: the binary's, or that of a child it handed the terminal to.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// Whether the command handed the terminal to a child, as a compose command passed through on one app: Ctrl-C is then
/// the child's, as with compose run by hand, and the binary leaves it alone. It stays handed over once the child ends,
/// as the end of the command, whose code is the child's, comes after. Its clones share it.
#[derive(Debug, Clone, Default)]
pub(crate) struct Terminal {
    is_handed_over: Arc<AtomicBool>,
}

impl Terminal {
    /// Runs `run`, a child that inherits the terminal, with the terminal handed over to it.
    pub(crate) async fn hand_over<T>(&self, run: impl Future<Output = T>) -> T {
        self.is_handed_over.store(true, Ordering::SeqCst);

        run.await
    }

    /// Whether the terminal was handed over to a child.
    pub(crate) fn is_handed_over(&self) -> bool {
        self.is_handed_over.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::Terminal;

    #[tokio::test]
    async fn is_handed_over_from_the_run_on() {
        let terminal = Terminal::default();

        assert!(!terminal.is_handed_over());

        let during = terminal
            .hand_over(async { terminal.is_handed_over() })
            .await;

        assert!(during);
        assert!(
            terminal.is_handed_over(),
            "the command ends after its child"
        );
    }
}
