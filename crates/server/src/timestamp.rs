//! The times the server gives the page, as when a store sync, a compose batch or a job started.

/// A time as the page reads it.
#[derive(Debug)]
pub(crate) struct Timestamp;

impl Timestamp {
    /// Now, in RFC 3339, to the millisecond, as the core writes the times of `.env.global`.
    pub(crate) fn now() -> String {
        Self::format(jiff::Timestamp::now())
    }

    /// `time`, in RFC 3339, to the millisecond.
    pub(crate) fn format(time: jiff::Timestamp) -> String {
        format!("{time:.3}")
    }
}
