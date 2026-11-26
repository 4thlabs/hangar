//! The times the server gives the page, as when a store sync or a compose batch started.

/// A time as the page reads it.
#[derive(Debug)]
pub(crate) struct Timestamp;

impl Timestamp {
    /// Now, in RFC 3339, to the millisecond, as the core writes the times of `.env.global`.
    pub(crate) fn now() -> String {
        format!("{:.3}", jiff::Timestamp::now())
    }
}
