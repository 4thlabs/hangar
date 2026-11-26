//! The rate limit of the password sign-in: the attempts counted per email, in a window.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// The sign-ins by password of the last [`WINDOW`](Self::WINDOW) that did not succeed, per email: those that failed,
/// and those still being checked.
///
/// An attempt is counted as it starts, under the lock, and forgotten with the others of its email if it succeeds: a
/// thousand attempts sent at once reserve ten of them, and the others are refused before any password check.
///
/// Per email, not per address: behind the reverse proxy Hangar is served through, every request comes from the
/// proxy's address, and a limit per address would be one for everyone. Ten attempts in fifteen minutes bound a guess
/// at a thousand a day for one user, which an argon2id hash and a password of eight characters or more stand; the
/// user who mistyped waits for the oldest attempt to leave the window, never more than fifteen minutes.
///
/// The users `hangar.yml` lists are counted apart from the emails it does not: there are only as many as it lists,
/// so they are always followed, and attempts on emails nobody signs in with never refuse a user. The unknown emails
/// are followed up to [`MAX_UNKNOWN`](Self::MAX_UNKNOWN), the one whose last attempt is the oldest forgotten for a new
/// one, so that guesses spread over many emails cannot fill the memory.
#[derive(Debug, Default)]
pub(crate) struct FailedSignIns {
    emails: Mutex<Emails>,
}

/// The attempts of the listed users and those of the unknown emails, each by email.
#[derive(Debug, Default)]
struct Emails {
    listed: HashMap<String, VecDeque<Instant>>,
    unknown: HashMap<String, VecDeque<Instant>>,
}

impl FailedSignIns {
    /// How long an attempt counts.
    const WINDOW: Duration = Duration::from_secs(15 * 60);
    /// How many attempts an email may have in the window before its sign-ins are refused.
    const MAX_ATTEMPTS: usize = 10;
    /// How many unknown emails are followed at once.
    const MAX_UNKNOWN: usize = 10_000;

    /// Counts an attempt to sign in as `email` at `now`, of a user `hangar.yml` lists or not; or how long the email
    /// must wait, its attempts in the window all spent.
    pub(crate) fn reserve(
        &self,
        email: &str,
        is_listed: bool,
        now: Instant,
    ) -> Result<(), Duration> {
        let mut emails = self.lock();
        let key = email.to_ascii_lowercase();
        let followed = if is_listed {
            &mut emails.listed
        } else {
            let unknown = &mut emails.unknown;

            if unknown.len() >= Self::MAX_UNKNOWN && !unknown.contains_key(&key) {
                Self::make_room(unknown, now);
            }

            unknown
        };
        let attempts = followed.entry(key).or_default();

        Self::forget_expired(attempts, now);

        if attempts.len() >= Self::MAX_ATTEMPTS {
            return Err(Self::wait(attempts, now));
        }

        attempts.push_back(now);

        Ok(())
    }

    /// Forgets the attempts of `email`, which just signed in.
    pub(crate) fn clear(&self, email: &str) {
        self.lock().listed.remove(&email.to_ascii_lowercase());
    }

    /// The attempts, whose lock no panic holds: every change is made under it with no call that panics.
    fn lock(&self) -> MutexGuard<'_, Emails> {
        self.emails.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Drops the unknown emails with no attempt left in the window at `now`, then, if they are still too many, the
    /// one whose last attempt is the oldest.
    fn make_room(unknown: &mut HashMap<String, VecDeque<Instant>>, now: Instant) {
        unknown.retain(|_, attempts| {
            Self::forget_expired(attempts, now);
            !attempts.is_empty()
        });

        if unknown.len() < Self::MAX_UNKNOWN {
            return;
        }

        let oldest = unknown
            .iter()
            .min_by_key(|(_, attempts)| attempts.back().copied())
            .map(|(email, _)| email.clone());

        if let Some(oldest) = oldest {
            unknown.remove(&oldest);
        }
    }

    /// Drops the attempts out of the window at `now`, the oldest first.
    fn forget_expired(attempts: &mut VecDeque<Instant>, now: Instant) {
        while attempts
            .front()
            .is_some_and(|time| now.saturating_duration_since(*time) >= Self::WINDOW)
        {
            attempts.pop_front();
        }
    }

    /// How long until the oldest of `attempts` leaves the window at `now`.
    fn wait(attempts: &VecDeque<Instant>, now: Instant) -> Duration {
        let oldest = attempts.front().copied().unwrap_or(now);

        Self::WINDOW.saturating_sub(now.saturating_duration_since(oldest))
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::FailedSignIns;

    const MINUTE: Duration = Duration::from_secs(60);

    #[test]
    fn refuses_an_email_after_ten_attempts_until_the_oldest_is_fifteen_minutes_old() {
        let failed = FailedSignIns::default();
        let start = Instant::now();

        for minute in 0..10 {
            assert_eq!(
                failed.reserve("ana@example.com", true, start + minute * MINUTE),
                Ok(())
            );
        }

        assert_eq!(
            failed.reserve("ana@example.com", true, start + 10 * MINUTE),
            Err(5 * MINUTE)
        );
        assert_eq!(
            failed.reserve("ANA@example.com", true, start + 10 * MINUTE),
            Err(5 * MINUTE),
            "whatever its case"
        );
        assert_eq!(
            failed.reserve("bo@example.com", true, start + 10 * MINUTE),
            Ok(()),
            "per email"
        );
        assert_eq!(
            failed.reserve("ana@example.com", true, start + 15 * MINUTE),
            Ok(())
        );
    }

    #[test]
    fn forgets_the_attempts_of_a_sign_in() {
        let failed = FailedSignIns::default();
        let now = Instant::now();

        for _ in 0..10 {
            failed
                .reserve("ana@example.com", true, now)
                .expect("reserved");
        }

        failed.clear("Ana@example.com");

        assert_eq!(failed.reserve("ana@example.com", true, now), Ok(()));
    }

    #[test]
    fn refuses_an_unknown_email_as_a_listed_one() {
        let failed = FailedSignIns::default();
        let now = Instant::now();

        for _ in 0..10 {
            failed
                .reserve("cy@example.com", false, now)
                .expect("reserved");
        }

        assert_eq!(
            failed.reserve("cy@example.com", false, now),
            Err(15 * MINUTE)
        );
    }

    #[test]
    fn never_refuses_a_user_because_of_the_unknown_emails() {
        let failed = FailedSignIns::default();
        let now = Instant::now();

        for index in 0..=FailedSignIns::MAX_UNKNOWN {
            let email = format!("guess{index}@example.com");

            assert_eq!(failed.reserve(&email, false, now), Ok(()), "{email}");
        }

        assert_eq!(failed.reserve("ana@example.com", true, now), Ok(()));
        assert_eq!(
            failed.lock().unknown.len(),
            FailedSignIns::MAX_UNKNOWN,
            "bounded"
        );
    }

    #[test]
    fn forgets_the_unknown_email_tried_longest_ago_first() {
        let failed = FailedSignIns::default();
        let start = Instant::now();

        for index in 0..FailedSignIns::MAX_UNKNOWN {
            failed
                .reserve(
                    &format!("guess{index}@example.com"),
                    false,
                    start + Duration::from_millis(index as u64),
                )
                .expect("reserved");
        }

        failed
            .reserve("one-more@example.com", false, start + MINUTE)
            .expect("reserved");

        let unknown = &failed.lock().unknown;

        assert!(!unknown.contains_key("guess0@example.com"));
        assert!(unknown.contains_key("guess1@example.com"));
    }
}
