//! The time the jobs' crons are read in: the server's own, in its time zone, or, in a test, a time that moves with
//! Tokio's clock, which a test pauses and moves on at once.

use jiff::Zoned;

/// What tells the time to the schedules of the jobs. Its clones tell the same.
#[derive(Debug, Clone)]
pub(crate) enum Clock {
    /// The time of the system, in its time zone: `TZ`, else `/etc/localtime`, else UTC, as node-cron reads it.
    System,
    /// `origin`, moved on as Tokio's clock moved since `at`.
    #[cfg(test)]
    Tokio {
        origin: Zoned,
        at: tokio::time::Instant,
    },
}

impl Clock {
    /// A clock that tells `origin` now, then moves with Tokio's clock, which a test pauses.
    #[cfg(test)]
    pub(crate) fn starting_at(origin: Zoned) -> Self {
        Self::Tokio {
            origin,
            at: tokio::time::Instant::now(),
        }
    }

    /// The time now.
    pub(crate) fn now(&self) -> Zoned {
        match self {
            Self::System => Zoned::now(),
            #[cfg(test)]
            Self::Tokio { origin, at } => origin
                .checked_add(at.elapsed())
                .expect("a test's clock stays within jiff's range"),
        }
    }
}
