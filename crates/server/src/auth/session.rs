//! The session: a signed cookie that holds the user's email, when they signed in, when it expires, and a value of
//! their credentials; nothing is kept on the server.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hangar_core::User;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::cookies::Cookies;

/// A session, as its cookie holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Session {
    /// The email of the user, as `hangar.yml` writes it.
    pub(crate) email: String,
    /// When the user signed in, in seconds since the epoch, which a renewal keeps.
    issued: u64,
    /// When it expires, in seconds since the epoch.
    expires: u64,
    /// The value of the user's credentials when they signed in, which [`credentials`](Self::credentials) gives.
    credentials: String,
}

impl Session {
    /// The cookie of the scheme `Session` of the contract.
    pub(crate) const COOKIE: &str = "__Host-hangar-session";

    /// How long a session lasts: seven days, as Better Auth's do in the Waku version.
    pub(crate) const LIFETIME: Duration = Duration::from_secs(7 * DAY);

    /// How old a session is renewed past, for [`LIFETIME`](Self::LIFETIME) again: a day, as Better Auth's
    /// `updateAge`, so that a session in use does not expire and a cookie is not written at each request.
    const RENEWAL: Duration = Duration::from_secs(DAY);

    /// How long a session lasts from the sign-in, renewals included: thirty days, after which the user signs in
    /// again. A cookie taken from a browser is then good for a month at most, not for as long as it is used.
    const MAX_AGE: Duration = Duration::from_secs(30 * DAY);

    /// A session of `user`, who signs in at `now`.
    pub(crate) fn new(user: &User, now: SystemTime) -> Self {
        let issued = Self::seconds(now);

        Self {
            email: user.email.clone(),
            issued,
            expires: Self::seconds(now + Self::LIFETIME),
            credentials: Self::credentials(user),
        }
    }

    /// The session renewed at `now`, for [`LIFETIME`](Self::LIFETIME) but never past [`MAX_AGE`](Self::MAX_AGE) from
    /// the sign-in.
    pub(crate) fn renewed(&self, now: SystemTime) -> Self {
        Self {
            expires: Self::seconds(now + Self::LIFETIME).min(self.end()),
            ..self.clone()
        }
    }

    /// The `Set-Cookie` of the session, which the browser keeps until it expires.
    pub(crate) fn cookie(&self, cookies: &Cookies, now: SystemTime) -> String {
        let lifetime = Duration::from_secs(self.expires.saturating_sub(Self::seconds(now)));

        cookies.signed(Self::COOKIE, self, lifetime)
    }

    /// The session the cookie of value `sealed` holds, if it was signed with this key and has not expired at `now`.
    pub(crate) fn open(cookies: &Cookies, sealed: &str, now: SystemTime) -> Option<Self> {
        let session: Self = cookies.open_signed(Self::COOKIE, sealed)?;
        let now = Self::seconds(now);

        (now < session.expires && now < session.end()).then_some(session)
    }

    /// Whether the session is still the one of `user`'s credentials: a password changed, or a subject set or
    /// changed, ends the sessions opened before.
    pub(crate) fn has_credentials_of(&self, user: &User) -> bool {
        self.credentials == Self::credentials(user)
    }

    /// Whether the session is past [`RENEWAL`](Self::RENEWAL) at `now`, and would be renewed for longer.
    pub(crate) fn is_due_for_renewal(&self, now: SystemTime) -> bool {
        let renewed_until = Self::seconds(now + Self::LIFETIME - Self::RENEWAL).min(self.end());

        self.expires < renewed_until
    }

    /// When the session ends whatever its renewals.
    fn end(&self) -> u64 {
        self.issued.saturating_add(Self::MAX_AGE.as_secs())
    }

    /// The value of `user`'s credentials: a SHA-256 of their password's hash and their subject, cut to 128 bits.
    /// It tells nothing of the password: the cookie holds no salt, and the hash it is made of is argon2id's.
    fn credentials(user: &User) -> String {
        let password_hash = user
            .password_hash
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default();
        let subject = user.oidc_subject.as_deref().unwrap_or_default();
        let digest = Sha256::new()
            .chain_update(b"password\0")
            .chain_update(password_hash.as_bytes())
            .chain_update(b"\0subject\0")
            .chain_update(subject.as_bytes())
            .finalize();

        URL_SAFE_NO_PAD.encode(&digest[..16])
    }

    /// `time` in whole seconds since the epoch; 0 before it.
    fn seconds(time: SystemTime) -> u64 {
        time.duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs())
    }
}

/// A day, in seconds.
const DAY: u64 = 24 * 60 * 60;

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use cookie::Cookie;
    use hangar_core::{PasswordHash, User};

    use super::{Cookies, DAY, Session};

    const HOUR: Duration = Duration::from_secs(60 * 60);

    fn cookies() -> Cookies {
        Cookies::new("0123456789abcdef0123456789abcdef")
    }

    /// Ana, with a password.
    fn ana() -> User {
        let hash = PasswordHash::new("correct horse").expect("hashed");
        let users = User::list(&format!(
            "users:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n"
        ))
        .expect("valid");

        users.into_iter().next().expect("Ana")
    }

    /// The value the session's `Set-Cookie` sets at `now`.
    fn sealed(session: &Session, now: SystemTime) -> String {
        Cookie::parse(session.cookie(&cookies(), now))
            .expect("a cookie")
            .value()
            .to_owned()
    }

    #[test]
    fn opens_until_it_expires_seven_days_on() {
        let now = SystemTime::now();
        let session = Session::new(&ana(), now);
        let sealed = sealed(&session, now);

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
        let now = SystemTime::now();
        let cookie =
            Cookie::parse(Session::new(&ana(), now).cookie(&cookies(), now)).expect("a cookie");

        assert_eq!(cookie.name(), "__Host-hangar-session");
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::days(7)));
    }

    #[test]
    fn is_renewed_once_a_day_old() {
        let now = SystemTime::now();
        let session = Session::new(&ana(), now);

        assert!(!session.is_due_for_renewal(now + 23 * HOUR));
        assert!(session.is_due_for_renewal(now + 25 * HOUR));
    }

    #[test]
    fn is_renewed_until_thirty_days_after_the_sign_in_and_no_longer() {
        let start = SystemTime::now();
        let mut session = Session::new(&ana(), start);

        for day in 1..=29 {
            let now = start + Duration::from_secs(day * DAY);

            if session.is_due_for_renewal(now) {
                session = session.renewed(now);
            }

            let sealed = sealed(&session, now);

            assert!(
                Session::open(&cookies(), &sealed, now).is_some(),
                "day {day}"
            );
        }

        let last = start + Duration::from_secs(29 * DAY);

        assert!(
            !session.is_due_for_renewal(last + 12 * HOUR),
            "it would not last longer"
        );
        assert_eq!(
            Session::open(
                &cookies(),
                &sealed(&session, last),
                start + Duration::from_secs(30 * DAY)
            ),
            None
        );
    }

    #[test]
    fn ends_once_the_credentials_change() {
        let now = SystemTime::now();
        let ana = ana();
        let session = Session::new(&ana, now);
        let mut with_another_password = ana.clone();
        let mut with_a_subject = ana.clone();

        with_another_password.password_hash =
            Some(PasswordHash::new("another horse").expect("hashed"));
        with_a_subject.oidc_subject = Some("ana-at-the-provider".to_owned());

        assert!(session.has_credentials_of(&ana));
        assert!(!session.has_credentials_of(&with_another_password));
        assert!(!session.has_credentials_of(&with_a_subject));
    }
}
