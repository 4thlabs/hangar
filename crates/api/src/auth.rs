//! Signing in: by password, or through the OpenID Connect provider, for the users `hangar.yml` lists; the session a
//! signed cookie, which every route but these and the health route takes.

use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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
        #[auth(crate::Session)]
        GET "/auth/session" => session() -> SessionUser;

        /// Starts a sign-in through the provider: a redirect to it, with the flow's cookie. A 404 when no provider is
        /// configured.
        GET "/auth/oidc/login" => oidc_login();

        /// Where the provider sends the browser back: the session's cookie for a user `hangar.yml` lists, by its
        /// subject or its verified email, and a redirect to the page; any other is sent back to `/login` with an
        /// `error` that says why.
        #[auth(crate::OidcFlow, optional)]
        GET "/auth/oidc/callback" => oidc_callback(query callback: &OidcCallback);
    }
}
