//! The session: a signed cookie that holds the user's email and when it expires, and nothing on the server.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::cookies::Cookies;

/// A session, as its cookie holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Session {
    /// The email of the user, as `hangar.yml` writes it.
    pub(crate) email: String,
    /// When it expires, in seconds since the epoch.
    expires: u64,
}

impl Session {
    /// The cookie of the scheme `Session` of the contract.
    pub(crate) const COOKIE: &str = "__Host-hangar-session";

    /// How long a session lasts: seven days, as Better Auth's do in the Waku version.
    pub(crate) const LIFETIME: Duration = Duration::from_secs(7 * 24 * 60 * 60);

    /// How old a session is renewed past, for [`LIFETIME`](Self::LIFETIME) again: a day, as Better Auth's
    /// `updateAge`, so that a session in use does not expire and a cookie is not written at each request.
    const RENEWAL: Duration = Duration::from_secs(24 * 60 * 60);

    /// A session of `email` from `now`.
    pub(crate) fn new(email: impl Into<String>, now: SystemTime) -> Self {
        Self {
            email: email.into(),
            expires: Self::seconds(now + Self::LIFETIME),
        }
    }

    /// The `Set-Cookie` of the session.
    pub(crate) fn cookie(&self, cookies: &Cookies) -> String {
        cookies.signed(Self::COOKIE, self, Self::LIFETIME)
    }

    /// The session the cookie of value `sealed` holds, if it was signed with this key and has not expired at `now`.
    pub(crate) fn open(cookies: &Cookies, sealed: &str, now: SystemTime) -> Option<Self> {
        let session: Self = cookies.open_signed(Self::COOKIE, sealed)?;

        (Self::seconds(now) < session.expires).then_some(session)
    }

    /// Whether the session is past [`RENEWAL`](Self::RENEWAL) at `now`, and is renewed.
    pub(crate) fn is_due_for_renewal(&self, now: SystemTime) -> bool {
        let renewed_until = Self::seconds(now + Self::LIFETIME - Self::RENEWAL);

        self.expires < renewed_until
    }

    /// `time` in whole seconds since the epoch; 0 before it.
    fn seconds(time: SystemTime) -> u64 {
        time.duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs())
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use cookie::Cookie;

    use super::{Cookies, Session};

    const HOUR: Duration = Duration::from_secs(60 * 60);

    fn cookies() -> Cookies {
        Cookies::new("0123456789abcdef0123456789abcdef")
    }

    /// The value the session's `Set-Cookie` sets.
    fn sealed(session: &Session) -> String {
        Cookie::parse(session.cookie(&cookies()))
            .expect("a cookie")
            .value()
            .to_owned()
    }

    #[test]
    fn opens_until_it_expires_seven_days_on() {
        let now = SystemTime::now();
        let session = Session::new("ana@example.com", now);
        let sealed = sealed(&session);

        assert_eq!(
            Session::open(&cookies(), &sealed, now),
            Some(session.clone())
        );
        assert_eq!(
            Session::open(&cookies(), &sealed, now + Session::LIFETIME - HOUR),
            Some(session)
        );
        assert_eq!(
            Session::open(&cookies(), &sealed, now + Session::LIFETIME),
            None
        );
    }

    #[test]
    fn lasts_as_long_in_the_browser() {
        let cookie =
            Cookie::parse(Session::new("ana@example.com", SystemTime::now()).cookie(&cookies()))
                .expect("a cookie");

        assert_eq!(cookie.name(), "__Host-hangar-session");
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::days(7)));
    }

    #[test]
    fn is_renewed_once_a_day_old() {
        let now = SystemTime::now();
        let session = Session::new("ana@example.com", now);

        assert!(!session.is_due_for_renewal(now + 23 * HOUR));
        assert!(session.is_due_for_renewal(now + 25 * HOUR));
    }
}
