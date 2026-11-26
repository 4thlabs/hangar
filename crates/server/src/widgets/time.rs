//! The times the widgets' services give, in RFC 3339 for the page, as the server writes its own.

use jiff::Timestamp;

/// A time a service gives, written for the page.
#[derive(Debug)]
pub(crate) struct Moment;

impl Moment {
    /// The time `seconds` after the epoch, to the millisecond, as Frigate writes its times.
    pub(crate) fn from_seconds(seconds: f64) -> String {
        // Saturates far past what a service gives, as far as a timestamp goes.
        Self::from_milliseconds((seconds * 1_000.0).round() as i64)
    }

    /// The time `milliseconds` after the epoch, as Backrest writes its times.
    pub(crate) fn from_milliseconds(milliseconds: i64) -> String {
        let timestamp = Timestamp::from_millisecond(milliseconds).unwrap_or(if milliseconds < 0 {
            Timestamp::MIN
        } else {
            Timestamp::MAX
        });

        format!("{timestamp:.3}")
    }
}

#[cfg(test)]
mod tests {
    use super::Moment;

    #[test]
    fn writes_a_time_to_the_millisecond() {
        assert_eq!(
            Moment::from_seconds(1_700_000_000.123_4),
            "2023-11-14T22:13:20.123Z"
        );
        assert_eq!(
            Moment::from_milliseconds(1_700_000_000_000),
            "2023-11-14T22:13:20.000Z"
        );
    }
}
