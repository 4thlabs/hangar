//! The rate limit of the password sign-in: the failures counted per email, in a window.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The failed sign-ins of the last [`WINDOW`](Self::WINDOW), per email.
///
/// Per email, not per address: behind the reverse proxy Hangar is served through, every request comes from the
/// proxy's address, and a limit per address would be one for everyone. Ten failures in fifteen minutes bound a
/// guess at a thousand a day for one user, which an argon2id hash and a password of eight characters or more stand;
/// the user who mistyped waits for the oldest failure to leave the window, never more than fifteen minutes.
///
/// The emails tried are bounded too: past [`MAX_EMAILS`](Self::MAX_EMAILS) with failures in the window, an email
/// with none is refused as well, so that guesses spread over many emails cannot fill the memory, nor push out the
/// failures of the one under attack.
#[derive(Debug, Default)]
pub(crate) struct FailedSignIns {
    failures: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl FailedSignIns {
    /// How long a failure counts.
    const WINDOW: Duration = Duration::from_secs(15 * 60);
    /// How many failures an email may have in the window before its sign-ins are refused.
    const MAX_FAILURES: usize = 10;
    /// How many emails are followed at once.
    const MAX_EMAILS: usize = 10_000;

    /// `Ok` when a sign-in of `email` may be tried at `now`, or how long it must wait.
    pub(crate) fn check(&self, email: &str, now: Instant) -> Result<(), Duration> {
        let mut failures = self.lock();
        let key = Self::key(email);

        if let Some(times) = failures.get_mut(&key) {
            Self::forget_expired(times, now);

            if times.len() < Self::MAX_FAILURES {
                return Ok(());
            }

            return Err(Self::wait(times, now));
        }

        if failures.len() < Self::MAX_EMAILS {
            return Ok(());
        }

        failures.retain(|_, times| {
            Self::forget_expired(times, now);
            !times.is_empty()
        });

        if failures.len() < Self::MAX_EMAILS {
            return Ok(());
        }

        Err(Self::WINDOW)
    }

    /// Counts a failed sign-in of `email` at `now`.
    pub(crate) fn record(&self, email: &str, now: Instant) {
        let mut failures = self.lock();
        let times = failures.entry(Self::key(email)).or_default();

        Self::forget_expired(times, now);
        times.push_back(now);
    }

    /// Forgets the failures of `email`, which just signed in.
    pub(crate) fn clear(&self, email: &str) {
        self.lock().remove(&Self::key(email));
    }

    /// The failures, whose lock no panic holds: every change is a single call on the map.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, VecDeque<Instant>>> {
        self.failures
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The email as the failures count it, whatever its case.
    fn key(email: &str) -> String {
        email.to_ascii_lowercase()
    }

    /// Drops the failures out of the window at `now`, the oldest first.
    fn forget_expired(times: &mut VecDeque<Instant>, now: Instant) {
        while times
            .front()
            .is_some_and(|time| now.saturating_duration_since(*time) >= Self::WINDOW)
        {
            times.pop_front();
        }
    }

    /// How long until the oldest failure of `times` leaves the window at `now`.
    fn wait(times: &VecDeque<Instant>, now: Instant) -> Duration {
        let oldest = times.front().copied().unwrap_or(now);

        Self::WINDOW.saturating_sub(now.saturating_duration_since(oldest))
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::FailedSignIns;

    const MINUTE: Duration = Duration::from_secs(60);

    #[test]
    fn refuses_an_email_after_ten_failures_until_the_oldest_is_fifteen_minutes_old() {
        let failed = FailedSignIns::default();
        let start = Instant::now();

        for minute in 0..10 {
            assert_eq!(
                failed.check("ana@example.com", start + minute * MINUTE),
                Ok(())
            );
            failed.record("ana@example.com", start + minute * MINUTE);
        }

        assert_eq!(
            failed.check("ana@example.com", start + 10 * MINUTE),
            Err(5 * MINUTE)
        );
        assert_eq!(
            failed.check("ANA@example.com", start + 10 * MINUTE),
            Err(5 * MINUTE),
            "whatever its case"
        );
        assert_eq!(
            failed.check("bo@example.com", start + 10 * MINUTE),
            Ok(()),
            "per email"
        );
        assert_eq!(failed.check("ana@example.com", start + 15 * MINUTE), Ok(()));
    }

    #[test]
    fn forgets_the_failures_of_a_sign_in() {
        let failed = FailedSignIns::default();
        let now = Instant::now();

        for _ in 0..10 {
            failed.record("ana@example.com", now);
        }

        failed.clear("Ana@example.com");

        assert_eq!(failed.check("ana@example.com", now), Ok(()));
    }

    #[test]
    fn refuses_a_new_email_once_too_many_have_failures() {
        let failed = FailedSignIns::default();
        let now = Instant::now();

        for index in 0..FailedSignIns::MAX_EMAILS {
            failed.record(&format!("user{index}@example.com"), now);
        }

        assert_eq!(
            failed.check("user0@example.com", now),
            Ok(()),
            "a followed email still counts its own"
        );
        assert!(failed.check("ana@example.com", now).is_err());
        assert_eq!(
            failed.check("ana@example.com", now + 15 * MINUTE),
            Ok(()),
            "once their failures leave the window"
        );
    }
}
