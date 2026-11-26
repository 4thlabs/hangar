//! The routes of the group `Auth`, and how the schemes `Session` and `OidcFlow` make a caller of their cookies.

use std::time::SystemTime;

use hangar_api::{
    AuthServer, CookieCredential, Credentials, OidcCallback, OidcFlow, Session as SessionScheme,
    SessionUser, SignInOptions,
};
use hangar_core::User;
use http::header::{LOCATION, SET_COOKIE};
use quoll::{Authenticate, Error, Response, Result, Status};

use super::SignedIn;
use super::cookies::ServerCookie;
use super::oidc::Flow;
use super::session::Session;
use crate::App;

/// The flow's cookie as the callback reads it: `None` when the cookie is no flow this key encrypted. Public, as the
/// caller of an `Authenticate` that `App` implements publicly, but out of reach outside the crate.
#[derive(Debug)]
pub struct FlowCookie(Option<Flow>);

/// Why a sign-in through the provider ends back on `/login`, as its `error` says it to the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    /// The provider cannot be reached, or its answer does not hold.
    Unavailable,
    /// The flow expired, or the callback is not the one of this browser's sign-in.
    Expired,
    /// The user declined at the provider, or it refused them.
    Denied,
    /// The provider signed in someone `hangar.yml` does not reference.
    NotAUser,
}

impl Refusal {
    /// The `error` of `/login`.
    fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "unavailable",
            Self::Expired => "expired",
            Self::Denied => "denied",
            Self::NotAUser => "not-a-user",
        }
    }
}

impl App {
    /// The user as the page shows them.
    fn session_user(user: &User) -> SessionUser {
        SessionUser {
            name: user.name.clone(),
            email: user.email.clone(),
        }
    }

    /// A redirect to `location`.
    fn redirect(location: &str) -> Response<()> {
        Response::new(())
            .with_status(Status::SEE_OTHER)
            .header(LOCATION, location)
    }

    /// The redirect of a sign-in through the provider that `refusal` ends, its flow's cookie cleared.
    fn refused(&self, refusal: Refusal) -> Response<()> {
        Self::redirect(&format!("/login?error={}", refusal.code())).header(
            SET_COOKIE,
            self.auth.cookies.cleared(ServerCookie::OidcFlow),
        )
    }
}

impl AuthServer for App {
    async fn options(&self) -> Result<Response<SignInOptions>> {
        Ok(Response::new(SignInOptions {
            oidc: self.auth.oidc.is_some(),
        }))
    }

    async fn login(&self, credentials: Credentials) -> Result<Response<SessionUser>> {
        let (user, cookie) = self.auth.sign_in(credentials).await?;

        Ok(Response::new(Self::session_user(&user)).header(SET_COOKIE, cookie))
    }

    async fn logout(&self) -> Result<Response<()>> {
        Ok(Response::new(()).header(SET_COOKIE, self.auth.cookies.cleared(ServerCookie::Session)))
    }

    async fn session(&self, signed_in: &SignedIn) -> Result<Response<SessionUser>> {
        let now = SystemTime::now();
        let response = Response::new(Self::session_user(&signed_in.user));

        if !signed_in.session.is_due_for_renewal(now) {
            return Ok(response);
        }

        let renewed = signed_in
            .session
            .renewed(now)
            .cookie(&self.auth.cookies, now);

        Ok(response.header(SET_COOKIE, renewed))
    }

    async fn oidc_login(&self) -> Result<Response<()>> {
        let Some(oidc) = &self.auth.oidc else {
            return Err(Error::not_found("no OpenID Connect provider is configured"));
        };

        match oidc.start(SystemTime::now()).await {
            Ok((url, flow)) => Ok(
                Self::redirect(url.as_str()).header(SET_COOKIE, flow.cookie(&self.auth.cookies))
            ),
            Err(error) => {
                tracing::warn!(
                    "the OpenID Connect sign-in cannot start: {}",
                    error.describe()
                );

                Ok(self.refused(Refusal::Unavailable))
            }
        }
    }

    async fn oidc_callback(
        &self,
        flow: Option<&FlowCookie>,
        callback: OidcCallback,
    ) -> Result<Response<()>> {
        let Some(oidc) = &self.auth.oidc else {
            return Err(Error::not_found("no OpenID Connect provider is configured"));
        };
        let now = SystemTime::now();
        let flow = flow
            .and_then(|cookie| cookie.0.as_ref())
            .filter(|flow| !flow.has_expired(now));
        let Some(flow) = flow else {
            return Ok(self.refused(Refusal::Expired));
        };

        if let Some(error) = &callback.error {
            tracing::info!("the OpenID Connect provider refused the sign-in: {error}");

            return Ok(self.refused(Refusal::Denied));
        }

        let is_this_flow = callback
            .state
            .as_deref()
            .is_some_and(|state| flow.has_state(state));
        let Some(code) = callback.code.filter(|_| is_this_flow) else {
            return Ok(self.refused(Refusal::Expired));
        };
        let identity = match oidc.finish(flow, code).await {
            Ok(identity) => identity,
            Err(error) => {
                tracing::warn!("the OpenID Connect sign-in failed: {}", error.describe());

                return Ok(self.refused(Refusal::Unavailable));
            }
        };
        let Some(user) = self.auth.referenced(&identity).await else {
            tracing::warn!(
                subject = %identity.subject,
                email = identity.verified_email.as_deref().unwrap_or("none verified"),
                "the OpenID Connect provider signed in someone hangar.yml does not reference"
            );

            return Ok(self.refused(Refusal::NotAUser));
        };
        let session = Session::new(&user, now).cookie(&self.auth.cookies, now);

        Ok(Self::redirect("/")
            .header(
                SET_COOKIE,
                self.auth.cookies.cleared(ServerCookie::OidcFlow),
            )
            .header(SET_COOKIE, session))
    }
}

impl Authenticate<SessionScheme> for App {
    type Caller = SignedIn;

    async fn authenticate(&self, cookie: CookieCredential) -> Result<SignedIn> {
        self.auth.signed_in(&cookie).await
    }
}

impl Authenticate<OidcFlow> for App {
    type Caller = FlowCookie;

    async fn authenticate(&self, cookie: CookieCredential) -> Result<FlowCookie> {
        Ok(FlowCookie(Flow::open(&self.auth.cookies, &cookie)))
    }
}
