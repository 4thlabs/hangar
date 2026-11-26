//! Signing in: by password, or through the OpenID Connect provider, for the users `hangar.yml` lists; the session a
//! signed cookie, which every route but these and the health route takes.

use std::fmt;

use http::header::COOKIE;
use http::request::Parts;
use quoll::openapi::SecurityScheme;
use quoll::{Error, Scheme};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ErrorCode;

/// A cookie of the server's as a request carries it, by both its names: `__Host-…` when the page is served over
/// HTTPS, and the bare name over plain HTTP, where a browser keeps neither a `Secure` cookie nor the prefix. The
/// server reads the one of its own scheme, and takes the other for no cookie.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct CookieCredential {
    /// The value of the cookie of the `__Host-` prefix, if the request carries it.
    pub https: Option<String>,
    /// The value of the cookie of the bare name, if the request carries it.
    pub http: Option<String>,
}

impl CookieCredential {
    /// The cookies `https` and `http` that `request` carries, the first value that is not empty of each, as quoll
    /// reads a declared cookie scheme; `None` when it carries neither.
    ///
    /// # Errors
    ///
    /// A 401 for a `Cookie` header that is not text.
    fn read(request: &Parts, https: &str, http: &str) -> quoll::Result<Option<Self>> {
        let mut credential = Self::default();

        for header in request.headers.get_all(COOKIE) {
            let header = header
                .to_str()
                .map_err(|_| Error::from(ErrorCode::UnreadableCookie))?;

            for pair in header.split(';') {
                let Some((name, value)) = pair.trim().split_once('=') else {
                    continue;
                };
                let slot = match name {
                    name if name == https => &mut credential.https,
                    name if name == http => &mut credential.http,
                    _ => continue,
                };

                if slot.is_none() && !value.is_empty() {
                    *slot = Some(value.to_owned());
                }
            }
        }

        let carries_one = credential.https.is_some() || credential.http.is_some();

        Ok(carries_one.then_some(credential))
    }
}

impl fmt::Debug for CookieCredential {
    /// Which cookies are there, not their values, which are credentials.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CookieCredential")
            .field("https", &self.https.is_some())
            .field("http", &self.http.is_some())
            .finish()
    }
}

/// The session of the page: a cookie the server signs, `HttpOnly` and `SameSite=Lax`, and over HTTPS `Secure`, with a
/// name a subdomain cannot set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Session;

impl Session {
    /// The session's cookie when `HANGAR_URL` is `https`.
    pub const HTTPS_COOKIE: &str = "__Host-hangar-session";
    /// The session's cookie when `HANGAR_URL` is plain `http`.
    pub const HTTP_COOKIE: &str = "hangar-session";
}

impl Scheme for Session {
    type Credential = CookieCredential;

    const NAME: &'static str = "Session";

    fn read(request: &Parts) -> quoll::Result<Option<CookieCredential>> {
        CookieCredential::read(request, Self::HTTPS_COOKIE, Self::HTTP_COOKIE)
    }

    fn openapi() -> SecurityScheme {
        SecurityScheme::cookie(Self::HTTPS_COOKIE).with_description(
            "The session of the page: a cookie the server signs, `HttpOnly` and `SameSite=Lax`. Over plain HTTP, \
             where a browser keeps no `Secure` cookie, it is `hangar-session`, neither `Secure` nor `__Host-`.",
        )
    }
}

/// The sign-in through the provider, from its start to its callback: a cookie the server encrypts, which holds the
/// state, the nonce and the PKCE verifier for ten minutes, named as the session's is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct OidcFlow;

impl OidcFlow {
    /// The flow's cookie when `HANGAR_URL` is `https`.
    pub const HTTPS_COOKIE: &str = "__Host-hangar-oidc";
    /// The flow's cookie when `HANGAR_URL` is plain `http`.
    pub const HTTP_COOKIE: &str = "hangar-oidc";
}

impl Scheme for OidcFlow {
    type Credential = CookieCredential;

    const NAME: &'static str = "OidcFlow";

    fn read(request: &Parts) -> quoll::Result<Option<CookieCredential>> {
        CookieCredential::read(request, Self::HTTPS_COOKIE, Self::HTTP_COOKIE)
    }

    fn openapi() -> SecurityScheme {
        SecurityScheme::cookie(Self::HTTPS_COOKIE).with_description(
            "The sign-in through the provider, from its start to its callback: a cookie the server encrypts, which \
             holds the state, the nonce and the PKCE verifier for ten minutes. Over plain HTTP, it is `hangar-oidc`.",
        )
    }
}

/// What the sign-in page offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SignInOptions {
    /// Whether an OpenID Connect provider is configured: the page then offers to sign in with it.
    pub oidc: bool,
}

/// The email and the password of a user of `hangar.yml`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Credentials {
    /// The user's email, whatever its case.
    pub email: String,
    /// The password.
    pub password: String,
}

impl fmt::Debug for Credentials {
    /// The email alone: a password is never logged.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credentials")
            .field("email", &self.email)
            .finish_non_exhaustive()
    }
}

/// The user a session is for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SessionUser {
    /// The name `hangar.yml` gives the user.
    pub name: String,
    /// The user's email, as `hangar.yml` writes it.
    pub email: String,
}

/// What the provider sends the browser back to the callback with: a code and the state, or an error.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct OidcCallback {
    /// The code to exchange for the tokens.
    pub code: Option<String>,
    /// The state the sign-in sent the provider, which must come back as it went.
    pub state: Option<String>,
    /// The provider's error, as `access_denied` when the user declines.
    pub error: Option<String>,
}

quoll::group! {
    /// Signing in and out. Every other route but the health route takes a `Session`, or answers 401.
    pub group Auth {
        /// What the sign-in page offers.
        GET "/auth/options" => options() -> SignInOptions;

        /// Signs in a user of `hangar.yml` by password, and sets the session's cookie. A wrong email or password is
        /// a 401, and too many of them for one email a 429.
        POST "/auth/login" => login(credentials: &Credentials) -> SessionUser;

        /// Signs out: the session's cookie is cleared.
        POST "/auth/logout" => logout();

        /// The signed-in user. A session past a day is renewed for seven more, so that one in use does not expire.
        #[auth(Session)]
        GET "/auth/session" => session() -> SessionUser;

        /// Starts a sign-in through the provider: a redirect to it, with the flow's cookie. A 404 when no provider is
        /// configured.
        GET "/auth/oidc/login" => oidc_login();

        /// Where the provider sends the browser back: the session's cookie for a user `hangar.yml` lists, by its
        /// subject or its verified email, and a redirect to the page; any other is sent back to `/login` with an
        /// `error` that says why.
        #[auth(OidcFlow, optional)]
        GET "/auth/oidc/callback" => oidc_callback(query callback: &OidcCallback);
    }
}

#[cfg(test)]
mod tests {
    use http::Request;

    use super::{CookieCredential, Session};
    use quoll::Scheme;

    /// The credential of `Session` in a request with these `Cookie` headers.
    fn read(cookies: &[&str]) -> Option<CookieCredential> {
        let mut request = Request::builder();

        for cookie in cookies {
            request = request.header("cookie", *cookie);
        }

        let (parts, ()) = request.body(()).expect("a request").into_parts();

        Session::read(&parts).expect("text")
    }

    #[test]
    fn reads_the_session_by_either_name() {
        let both = read(&["theme=dark; __Host-hangar-session=signed; hangar-session=plain"])
            .expect("both");

        assert_eq!(both.https.as_deref(), Some("signed"));
        assert_eq!(both.http.as_deref(), Some("plain"));
        assert_eq!(
            read(&["hangar-session=plain"]).and_then(|cookie| cookie.https),
            None
        );
    }

    #[test]
    fn takes_the_first_value_that_is_not_empty() {
        let credential = read(&[
            "hangar-session=",
            "hangar-session=first; hangar-session=second",
        ])
        .expect("one");

        assert_eq!(credential.http.as_deref(), Some("first"));
    }

    #[test]
    fn carries_no_credential_without_either_cookie() {
        assert_eq!(read(&["theme=dark; hangar-sessionx=1"]), None);
        assert_eq!(read(&[]), None);
        assert_eq!(read(&["hangar-session="]), None);
    }
}
