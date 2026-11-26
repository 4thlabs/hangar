//! The cookies the server signs or encrypts, with the keys derived from `HANGAR_SECRET`, named and set as the scheme
//! of `HANGAR_URL` asks.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use cookie::{Cookie, CookieJar, Key, SameSite};
use hangar_api::{CookieCredential, OidcFlow, Session};
use serde::Serialize;
use serde::de::DeserializeOwned;

/// A cookie of the server's, which has a name over HTTPS and another over plain HTTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ServerCookie {
    /// The session, of the scheme `Session`.
    Session,
    /// The sign-in through the provider, of the scheme `OidcFlow`.
    OidcFlow,
}

impl ServerCookie {
    /// The name of the cookie, `__Host-…` when `secure`.
    fn name(self, secure: bool) -> &'static str {
        match (self, secure) {
            (Self::Session, true) => Session::HTTPS_COOKIE,
            (Self::Session, false) => Session::HTTP_COOKIE,
            (Self::OidcFlow, true) => OidcFlow::HTTPS_COOKIE,
            (Self::OidcFlow, false) => OidcFlow::HTTP_COOKIE,
        }
    }
}

/// Seals what a cookie holds, and opens it again: signed, which the browser reads but cannot change, or encrypted,
/// which it cannot read either. What it holds is JSON, in base64url so that a cookie's value takes it as it is.
///
/// The signature of the `cookie` crate covers the value alone, where its encryption takes the name in too: a signed
/// value holds its cookie's name beside what it carries, `[name, value]`, so that it opens under no other name.
///
/// It is the `cookie` crate's signed and private jars, which axum-extra's `SignedCookieJar` and `PrivateCookieJar`
/// wrap: quoll's handlers take no axum extractor, so the jars are used beneath them.
///
/// Every cookie it writes is `HttpOnly`, `SameSite=Lax` and on `/`: a script cannot read it, and a cross-site `POST`
/// does not carry it. When `HANGAR_URL` is `https`, it is also `Secure`, with a name of the prefix `__Host-`: it
/// travels on HTTPS alone, and a page of a subdomain, as the apps Hangar serves, cannot set it. Over plain HTTP a
/// browser keeps neither, Safari on `localhost` included: the cookie has its bare name, and plain HTTP is for a
/// trusted network only. A request's cookie of the other scheme is no cookie.
pub(crate) struct Cookies {
    key: Key,
    secure: bool,
}

impl Cookies {
    /// The cookies of the keys `secret` derives, with HKDF: a signing key and an encryption key, apart; `Secure` and
    /// `__Host-` when `secure`, the page being served over HTTPS.
    ///
    /// # Panics
    ///
    /// With a `secret` shorter than 32 bytes, which the settings refuse.
    pub(crate) fn new(secret: &str, secure: bool) -> Self {
        Self {
            key: Key::derive_from(secret.as_bytes()),
            secure,
        }
    }

    /// The `Set-Cookie` of `cookie` holding `value`, signed, for `lifetime`.
    pub(crate) fn signed(
        &self,
        cookie: ServerCookie,
        value: &impl Serialize,
        lifetime: Duration,
    ) -> String {
        let name = cookie.name(self.secure);
        let mut jar = CookieJar::new();

        jar.signed_mut(&self.key)
            .add(Cookie::new(name, Self::encode(&(name, value))));

        self.set_cookie(&jar, name, lifetime)
    }

    /// The `Set-Cookie` of `cookie` holding `value`, encrypted, for `lifetime`.
    pub(crate) fn private(
        &self,
        cookie: ServerCookie,
        value: &impl Serialize,
        lifetime: Duration,
    ) -> String {
        let name = cookie.name(self.secure);
        let mut jar = CookieJar::new();

        jar.private_mut(&self.key)
            .add(Cookie::new(name, Self::encode(value)));

        self.set_cookie(&jar, name, lifetime)
    }

    /// What the signed `cookie` of `credential` holds; `None` for one this key did not sign, that holds no `T`, or
    /// that the request does not carry under the name of this scheme.
    pub(crate) fn open_signed<T: DeserializeOwned>(
        &self,
        cookie: ServerCookie,
        credential: &CookieCredential,
    ) -> Option<T> {
        let name = cookie.name(self.secure);
        let jar = Self::jar(name, self.sealed(credential)?);
        let opened = jar.signed(&self.key).get(name)?;
        let (signed_name, value): (String, T) = Self::decode(opened.value())?;

        (signed_name == name).then_some(value)
    }

    /// What the encrypted `cookie` of `credential` holds; `None` for one this key did not encrypt, that holds no `T`,
    /// or that the request does not carry under the name of this scheme.
    pub(crate) fn open_private<T: DeserializeOwned>(
        &self,
        cookie: ServerCookie,
        credential: &CookieCredential,
    ) -> Option<T> {
        let name = cookie.name(self.secure);
        let jar = Self::jar(name, self.sealed(credential)?);
        let opened = jar.private(&self.key).get(name)?;

        Self::decode(opened.value())
    }

    /// The `Set-Cookie` that clears `cookie`.
    pub(crate) fn cleared(&self, cookie: ServerCookie) -> String {
        self.attributes(Cookie::new(cookie.name(self.secure), ""), Duration::ZERO)
            .to_string()
    }

    /// The value of `credential` under the name of this scheme.
    fn sealed<'a>(&self, credential: &'a CookieCredential) -> Option<&'a str> {
        let sealed = if self.secure {
            &credential.https
        } else {
            &credential.http
        };

        sealed.as_deref()
    }

    /// A jar of the cookie `name` of value `sealed`, as the browser sent it.
    fn jar(name: &'static str, sealed: &str) -> CookieJar {
        let mut jar = CookieJar::new();

        jar.add_original(Cookie::new(name, sealed.to_owned()));
        jar
    }

    /// The `Set-Cookie` of the cookie `name` that `jar` sealed.
    fn set_cookie(&self, jar: &CookieJar, name: &'static str, lifetime: Duration) -> String {
        let sealed = jar
            .get(name)
            .expect("the jar holds the cookie it was just given")
            .clone();

        self.attributes(sealed, lifetime).to_string()
    }

    /// `cookie` with the attributes of every cookie of the server, and its `Max-Age`.
    fn attributes(&self, mut cookie: Cookie<'static>, lifetime: Duration) -> Cookie<'static> {
        let seconds = i64::try_from(lifetime.as_secs()).unwrap_or(i64::MAX);

        cookie.set_path("/");
        cookie.set_secure(self.secure);
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
    use hangar_api::CookieCredential;
    use serde::{Deserialize, Serialize};

    use super::{Cookies, ServerCookie};

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

    /// The credential of a request that sends back the cookie a `Set-Cookie` sets.
    fn sent_back(set_cookie: &str) -> CookieCredential {
        let cookie = Cookie::parse(set_cookie.to_owned()).expect("a cookie");
        let value = Some(cookie.value().to_owned());

        if cookie.name().starts_with("__Host-") {
            CookieCredential {
                https: value,
                http: None,
            }
        } else {
            CookieCredential {
                https: None,
                http: value,
            }
        }
    }

    #[test]
    fn sets_a_cookie_only_its_own_origin_reads_over_https() {
        let set_cookie = Cookies::new(SECRET, true).signed(
            ServerCookie::Session,
            &held(),
            Duration::from_secs(60),
        );
        let cookie = Cookie::parse(set_cookie).expect("a cookie");

        assert_eq!(cookie.name(), "__Host-hangar-session");
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.same_site(), Some(cookie::SameSite::Lax));
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::seconds(60)));
        assert_eq!(cookie.domain(), None);
    }

    #[test]
    fn sets_a_cookie_neither_secure_nor_prefixed_over_plain_http() {
        let cookies = Cookies::new(SECRET, false);
        let set_cookie = cookies.private(ServerCookie::OidcFlow, &held(), Duration::from_secs(60));
        let cookie = Cookie::parse(set_cookie.clone()).expect("a cookie");

        assert_eq!(cookie.name(), "hangar-oidc");
        assert_eq!(cookie.secure(), None);
        assert!(!set_cookie.contains("Secure"), "{set_cookie}");
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.same_site(), Some(cookie::SameSite::Lax));
        assert_eq!(
            cookies.open_private::<Held>(ServerCookie::OidcFlow, &sent_back(&set_cookie)),
            Some(held())
        );
    }

    #[test]
    fn opens_what_it_signed_and_nothing_tampered_with() {
        let cookies = Cookies::new(SECRET, true);
        let credential =
            sent_back(&cookies.signed(ServerCookie::Session, &held(), Duration::from_secs(60)));
        let sealed = credential.https.clone().expect("prefixed");
        let mut tampered = sealed.clone();

        tampered.pop();
        tampered.push(if sealed.ends_with('A') { 'B' } else { 'A' });

        assert_eq!(
            cookies.open_signed::<Held>(ServerCookie::Session, &credential),
            Some(held())
        );
        assert_eq!(
            cookies.open_signed::<Held>(
                ServerCookie::Session,
                &CookieCredential {
                    https: Some(tampered),
                    http: None
                }
            ),
            None
        );
        assert_eq!(
            cookies.open_signed::<Held>(ServerCookie::OidcFlow, &credential),
            None,
            "the name is signed too"
        );
    }

    #[test]
    fn opens_no_cookie_of_the_other_scheme() {
        let over_https = Cookies::new(SECRET, true);
        let over_http = Cookies::new(SECRET, false);
        let prefixed =
            sent_back(&over_https.signed(ServerCookie::Session, &held(), Duration::from_secs(60)));
        let bare =
            sent_back(&over_http.signed(ServerCookie::Session, &held(), Duration::from_secs(60)));
        let bare_as_prefixed = CookieCredential {
            https: bare.http.clone(),
            http: None,
        };

        assert_eq!(
            over_http.open_signed::<Held>(ServerCookie::Session, &prefixed),
            None
        );
        assert_eq!(
            over_https.open_signed::<Held>(ServerCookie::Session, &bare),
            None
        );
        assert_eq!(
            over_https.open_signed::<Held>(ServerCookie::Session, &bare_as_prefixed),
            None,
            "signed under the bare name"
        );
    }

    #[test]
    fn opens_nothing_another_secret_sealed() {
        let credential = sent_back(&Cookies::new(SECRET, true).signed(
            ServerCookie::Session,
            &held(),
            Duration::from_secs(60),
        ));
        let other = Cookies::new("another secret of at least 32 bytes", true);

        assert_eq!(
            other.open_signed::<Held>(ServerCookie::Session, &credential),
            None
        );
    }

    #[test]
    fn encrypts_a_private_cookie() {
        let cookies = Cookies::new(SECRET, true);
        let credential =
            sent_back(&cookies.private(ServerCookie::OidcFlow, &held(), Duration::from_secs(60)));

        assert!(
            !credential
                .https
                .as_deref()
                .is_some_and(|sealed| sealed.contains("ana"))
        );
        assert_eq!(
            cookies.open_private::<Held>(ServerCookie::OidcFlow, &credential),
            Some(held())
        );
        assert_eq!(
            cookies.open_signed::<Held>(ServerCookie::OidcFlow, &credential),
            None
        );
    }

    #[test]
    fn clears_a_cookie() {
        let cookie = Cookie::parse(Cookies::new(SECRET, true).cleared(ServerCookie::Session))
            .expect("a cookie");

        assert_eq!(cookie.name(), "__Host-hangar-session");
        assert_eq!(cookie.value(), "");
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::ZERO));
        assert_eq!(cookie.path(), Some("/"));
    }
}
