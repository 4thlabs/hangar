//! Signing in, for the users `hangar.yml` lists: by password, or through the OpenID Connect provider for a user it
//! references by subject or by verified email; the session a signed cookie, and nothing kept on the server.
//!
//! There are no roles: a user signed in may do everything, as with the Waku version's one account.

mod body_limit;
mod cookies;
mod failed_sign_ins;
mod oidc;
mod origin;
mod routes;
mod session;
mod users;

use std::time::{Duration, Instant, SystemTime};

use hangar_api::{CookieCredential, Credentials, ErrorCode};
use hangar_core::{PasswordHash, Runtime, Store, User};
use quoll::Error;
use tokio::sync::Semaphore;

use crate::Settings;
use cookies::Cookies;
use failed_sign_ins::FailedSignIns;
use oidc::{Identity, Oidc};
use session::Session;
use users::Users;

pub(crate) use body_limit::AuthBodyLimit;
pub(crate) use origin::OriginCheck;

/// What signing in runs on: the keys of the cookies, the users, the failures of the password sign-in, and the
/// provider.
pub(crate) struct Auth {
    cookies: Cookies,
    users: Users,
    failures: FailedSignIns,
    /// The password checks running at once. Each takes 19 MiB and some 50 ms of a core, every hash being of the
    /// default costs: a burst of sign-ins waits its turn rather than take the server's memory.
    checks: Semaphore,
    oidc: Option<Oidc>,
}

/// Who a request with a valid session comes from. Public, as the caller of an `Authenticate` that `App` implements
/// publicly, but out of reach outside the crate: its module is private.
#[derive(Debug, Clone)]
pub struct SignedIn {
    /// The user, as `hangar.yml` lists them now.
    user: User,
    /// The session of the cookie.
    session: Session,
}

impl Auth {
    /// The password checks that run at once.
    const CONCURRENT_CHECKS: usize = 2;
    /// The longest email `hangar.yml` takes, as SMTP bounds one.
    const MAX_EMAIL_LENGTH: usize = 254;

    /// Signing in with the settings of the server, its users read from the store of its data directory.
    pub(crate) fn new(settings: &Settings) -> Self {
        let store = Store::new(
            settings.store_url.clone(),
            settings.data_dir.clone(),
            Runtime::new(),
        );

        Self {
            cookies: Cookies::new(settings.auth.secret.expose(), settings.auth.is_https()),
            users: Users::new(store),
            failures: FailedSignIns::default(),
            checks: Semaphore::new(Self::CONCURRENT_CHECKS),
            oidc: settings.auth.oidc.clone().map(Oidc::new),
        }
    }

    /// Readies signing in as the server starts: the hash of nobody's password is made, so that the first sign-in of
    /// an unknown email takes no longer than another, and who may sign in is logged, so that a server nobody can sign
    /// in to says so.
    pub(crate) async fn start(&self) {
        if let Err(error) = tokio::task::spawn_blocking(|| PasswordHash::verify_none("")).await {
            tracing::error!("the hash of nobody's password could not be made: {error}");
        }

        let users = self.users.current().await;
        let by_password = users
            .iter()
            .filter(|user| user.password_hash.is_some())
            .count();

        if users.is_empty() {
            tracing::warn!("hangar.yml lists no users: nobody can sign in");
        } else {
            tracing::info!(
                "{} users may sign in, {by_password} of them by password",
                users.len()
            );
        }

        match &self.oidc {
            Some(oidc) => tracing::info!(
                "signing in through the OpenID Connect provider {}",
                oidc.issuer()
            ),
            None => tracing::info!("no OpenID Connect provider: HANGAR_OIDC_ISSUER is not set"),
        }
    }

    /// Signs in by password: the user, and the `Set-Cookie` of their session.
    ///
    /// The password is checked whether the user is listed or not, against a hash of nobody's for a user unknown or
    /// with none, so that the time of the answer does not tell which emails are users. The attempt is counted before
    /// the check, and forgotten if it succeeds. An email longer than any `hangar.yml` takes is refused at once, before
    /// it is counted, so that what the rate limit keeps is bounded.
    pub(crate) async fn sign_in(&self, credentials: Credentials) -> quoll::Result<(User, String)> {
        let Credentials { email, password } = credentials;

        if email.len() > Self::MAX_EMAIL_LENGTH {
            return Err(Self::invalid_credentials());
        }

        let user = self.users.find(&email).await;

        self.failures
            .reserve(&email, user.is_some(), Instant::now())
            .map_err(Self::too_many_failures)?;

        let hash = user.as_ref().and_then(|user| user.password_hash.clone());
        let is_valid = self.check(hash, password).await?;
        let Some(user) = user.filter(|_| is_valid) else {
            return Err(Self::invalid_credentials());
        };

        self.failures.clear(&email);

        let now = SystemTime::now();
        let cookie = Session::new(&user, now).cookie(&self.cookies, now);

        Ok((user, cookie))
    }

    /// The session the cookie of `credential` holds, for a user `hangar.yml` still lists with the same credentials.
    pub(crate) async fn signed_in(&self, credential: &CookieCredential) -> quoll::Result<SignedIn> {
        let Some(session) = Session::open(&self.cookies, credential, SystemTime::now()) else {
            return Err(ErrorCode::SessionExpired.into());
        };
        let Some(user) = self.users.find(&session.email).await else {
            return Err(ErrorCode::UserRemoved.into());
        };

        if !session.has_credentials_of(&user) {
            return Err(ErrorCode::CredentialsChanged.into());
        }

        Ok(SignedIn { user, session })
    }

    /// The user `hangar.yml` references for `identity`: the one of its subject, or else the one of its verified email
    /// that has no subject of its own, which then signs in by it alone.
    async fn referenced(&self, identity: &Identity) -> Option<User> {
        let users = self.users.current().await;
        let by_subject = users
            .iter()
            .find(|user| user.oidc_subject.as_deref() == Some(identity.subject.as_str()));
        let by_email = || {
            let email = identity.verified_email.as_deref()?;

            users
                .iter()
                .find(|user| user.oidc_subject.is_none() && user.has_email(email))
        };

        by_subject.or_else(by_email).cloned()
    }

    /// Whether `password` is the one of `hash`, checked off the runtime's threads; `false` for no hash, after the
    /// same time.
    async fn check(&self, hash: Option<PasswordHash>, password: String) -> quoll::Result<bool> {
        let _turn = self.checks.acquire().await.map_err(Error::internal)?;

        tokio::task::spawn_blocking(move || match hash {
            Some(hash) => hash.verify(&password),
            None => {
                PasswordHash::verify_none(&password);
                false
            }
        })
        .await
        .map_err(Error::internal)
    }

    /// The 401 of a wrong email or password.
    fn invalid_credentials() -> Error {
        ErrorCode::InvalidCredentials.into()
    }

    /// The 429 of an email whose sign-ins are refused for `wait`, which its `Retry-After` says.
    fn too_many_failures(wait: Duration) -> Error {
        Error::from(ErrorCode::TooManySignIns).retry_after(wait)
    }
}

impl std::fmt::Debug for Auth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Auth")
            .field("users", &self.users)
            .field("oidc", &self.oidc)
            .finish_non_exhaustive()
    }
}
