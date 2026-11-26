//! The time the jobs' crons are read in: the server's own, in its time zone, or, in a test, a time that moves with
//! Tokio's clock, which a test pauses and moves on at once, and that the test may move on alone, as the system's
//! clock does while the host is suspended.

#[cfg(test)]
use std::sync::Arc;
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

use jiff::Zoned;

/// What tells the time to the schedules of the jobs. Its clones tell the same.
#[derive(Debug, Clone)]
pub(crate) enum Clock {
    /// The time of the system, in its time zone: `TZ`, else `/etc/localtime`, else UTC, as node-cron reads it.
    System,
    /// `origin`, moved on as Tokio's clock moved since `at`, and by the seconds `jumped`.
    #[cfg(test)]
    Tokio {
        origin: Zoned,
        at: tokio::time::Instant,
        jumped: Arc<AtomicU64>,
    },
}

impl Clock {
    /// A clock that tells `origin` now, then moves with Tokio's clock, which a test pauses.
    #[cfg(test)]
    pub(crate) fn starting_at(origin: Zoned) -> Self {
        Self::Tokio {
            origin,
            at: tokio::time::Instant::now(),
            jumped: Arc::default(),
        }
    }

    /// Moves the time on by `seconds`, where Tokio's clock does not move, as a host resumed after a suspend.
    #[cfg(test)]
    pub(crate) fn jump(&self, seconds: u64) {
        if let Self::Tokio { jumped, .. } = self {
            jumped.fetch_add(seconds, Ordering::SeqCst);
        }
    }

    /// The time now.
    pub(crate) fn now(&self) -> Zoned {
        match self {
            Self::System => Zoned::now(),
            #[cfg(test)]
            Self::Tokio { origin, at, jumped } => origin
                .checked_add(at.elapsed())
                .and_then(|now| {
                    now.checked_add(std::time::Duration::from_secs(
                        jumped.load(Ordering::SeqCst),
                    ))
                })
                .expect("a test's clock stays within jiff's range"),
        }
    }
}
