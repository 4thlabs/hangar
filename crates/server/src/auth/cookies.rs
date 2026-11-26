//! The cookies the server signs or encrypts, with the keys derived from `HANGAR_SECRET`.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use cookie::{Cookie, CookieJar, Key, SameSite};
use serde::Serialize;
use serde::de::DeserializeOwned;

/// Seals what a cookie holds, and opens it again: signed, which the browser reads but cannot change, or encrypted,
/// which it cannot read either. What it holds is JSON, in base64url so that a cookie's value takes it as it is.
///
/// The signature of the `cookie` crate covers the value alone, where its encryption takes the name in too: a signed
/// value holds its cookie's name beside what it carries, `[name, value]`, so that it opens under no other name.
///
/// It is the `cookie` crate's signed and private jars, which axum-extra's `SignedCookieJar` and `PrivateCookieJar`
/// wrap: quoll's handlers take no axum extractor, so the jars are used beneath them.
///
/// Every cookie it writes is `HttpOnly`, `Secure`, `SameSite=Lax` and on `/`, with a name of the prefix `__Host-`:
/// a script cannot read it, it travels on HTTPS alone (and to `localhost`, which browsers take as secure), a
/// cross-site `POST` does not carry it, and a page of a subdomain, as the apps Hangar serves, cannot set it.
pub(crate) struct Cookies {
    key: Key,
}

impl Cookies {
    /// The cookies of the keys `secret` derives, with HKDF: a signing key and an encryption key, apart.
    ///
    /// # Panics
    ///
    /// With a `secret` shorter than 32 bytes, which the settings refuse.
    pub(crate) fn new(secret: &str) -> Self {
        Self {
            key: Key::derive_from(secret.as_bytes()),
        }
    }

    /// The `Set-Cookie` of a cookie `name` that holds `value`, signed, for `lifetime`.
    pub(crate) fn signed(
        &self,
        name: &'static str,
        value: &impl Serialize,
        lifetime: Duration,
    ) -> String {
        let mut jar = CookieJar::new();

        jar.signed_mut(&self.key)
            .add(Cookie::new(name, Self::encode(&(name, value))));

        Self::set_cookie(&jar, name, lifetime)
    }

    /// The `Set-Cookie` of a cookie `name` that holds `value`, encrypted, for `lifetime`.
    pub(crate) fn private(
        &self,
        name: &'static str,
        value: &impl Serialize,
        lifetime: Duration,
    ) -> String {
        let mut jar = CookieJar::new();

        jar.private_mut(&self.key)
            .add(Cookie::new(name, Self::encode(value)));

        Self::set_cookie(&jar, name, lifetime)
    }

    /// What the signed cookie `name` of value `sealed` holds; `None` for one this key did not sign, or that holds no
    /// `T`.
    pub(crate) fn open_signed<T: DeserializeOwned>(
        &self,
        name: &'static str,
        sealed: &str,
    ) -> Option<T> {
        let jar = Self::jar(name, sealed);
        let cookie = jar.signed(&self.key).get(name)?;
        let (signed_name, value): (String, T) = Self::decode(cookie.value())?;

        (signed_name == name).then_some(value)
    }

    /// What the encrypted cookie `name` of value `sealed` holds; `None` for one this key did not encrypt, or that
    /// holds no `T`.
    pub(crate) fn open_private<T: DeserializeOwned>(
        &self,
        name: &'static str,
        sealed: &str,
    ) -> Option<T> {
        let jar = Self::jar(name, sealed);
        let cookie = jar.private(&self.key).get(name)?;

        Self::decode(cookie.value())
    }

    /// The `Set-Cookie` that clears the cookie `name`.
    pub(crate) fn cleared(name: &'static str) -> String {
        Self::attributes(Cookie::new(name, ""), Duration::ZERO).to_string()
    }

    /// A jar of the cookie `name` of value `sealed`, as the browser sent it.
    fn jar(name: &'static str, sealed: &str) -> CookieJar {
        let mut jar = CookieJar::new();

        jar.add_original(Cookie::new(name, sealed.to_owned()));
        jar
    }

    /// The `Set-Cookie` of the cookie `name` that `jar` sealed.
    fn set_cookie(jar: &CookieJar, name: &'static str, lifetime: Duration) -> String {
        let sealed = jar
            .get(name)
            .expect("the jar holds the cookie it was just given")
            .clone();

        Self::attributes(sealed, lifetime).to_string()
    }

    /// `cookie` with the attributes of every cookie of the server, and its `Max-Age`.
    fn attributes(mut cookie: Cookie<'static>, lifetime: Duration) -> Cookie<'static> {
        let seconds = i64::try_from(lifetime.as_secs()).unwrap_or(i64::MAX);

        cookie.set_path("/");
        cookie.set_secure(true);
        cookie.set_http_only(true);
        cookie.set_same_site(SameSite::Lax);
        cookie.set_max_age(cookie::time::Duration::seconds(seconds));
        cookie
    }

    /// `value` as JSON, in base64url.
    fn encode(value: &impl Serialize) -> String {
        let json = serde_json::to_vec(value).expect("what a cookie holds serializes to JSON");

        URL_SAFE_NO_PAD.encode(json)
    }

    /// The `T` that `encoded` holds.
    fn decode<T: DeserializeOwned>(encoded: &str) -> Option<T> {
        let json = URL_SAFE_NO_PAD.decode(encoded).ok()?;

        serde_json::from_slice(&json).ok()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use cookie::Cookie;
    use serde::{Deserialize, Serialize};

    use super::Cookies;

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Held {
        email: String,
    }

    fn held() -> Held {
        Held {
            email: "ana@example.com".to_owned(),
        }
    }

    /// The value of the cookie a `Set-Cookie` sets.
    fn value(set_cookie: &str) -> String {
        Cookie::parse(set_cookie.to_owned())
            .expect("a cookie")
            .value()
            .to_owned()
    }

    #[test]
    fn sets_a_cookie_only_its_own_origin_reads_over_https() {
        let set_cookie =
            Cookies::new(SECRET).signed("__Host-test", &held(), Duration::from_secs(60));
        let cookie = Cookie::parse(set_cookie).expect("a cookie");

        assert_eq!(cookie.name(), "__Host-test");
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.same_site(), Some(cookie::SameSite::Lax));
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::seconds(60)));
        assert_eq!(cookie.domain(), None);
    }

    #[test]
    fn opens_what_it_signed_and_nothing_tampered_with() {
        let cookies = Cookies::new(SECRET);
        let sealed = value(&cookies.signed("__Host-test", &held(), Duration::from_secs(60)));
        let mut tampered = sealed.clone();

        tampered.pop();
        tampered.push(if sealed.ends_with('A') { 'B' } else { 'A' });

        assert_eq!(
            cookies.open_signed::<Held>("__Host-test", &sealed),
            Some(held())
        );
        assert_eq!(cookies.open_signed::<Held>("__Host-test", &tampered), None);
        assert_eq!(
            cookies.open_signed::<Held>("__Host-other", &sealed),
            None,
            "the name is signed too"
        );
    }

    #[test]
    fn opens_nothing_another_secret_sealed() {
        let sealed =
            value(&Cookies::new(SECRET).signed("__Host-test", &held(), Duration::from_secs(60)));
        let other = Cookies::new("another secret of at least 32 bytes");

        assert_eq!(other.open_signed::<Held>("__Host-test", &sealed), None);
    }

    #[test]
    fn encrypts_a_private_cookie() {
        let cookies = Cookies::new(SECRET);
        let sealed = value(&cookies.private("__Host-test", &held(), Duration::from_secs(60)));

        assert!(!sealed.contains("ana"));
        assert_eq!(
            cookies.open_private::<Held>("__Host-test", &sealed),
            Some(held())
        );
        assert_eq!(cookies.open_signed::<Held>("__Host-test", &sealed), None);
    }

    #[test]
    fn clears_a_cookie() {
        let cookie = Cookie::parse(Cookies::cleared("__Host-test")).expect("a cookie");

        assert_eq!(cookie.value(), "");
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::ZERO));
        assert_eq!(cookie.path(), Some("/"));
    }
}
