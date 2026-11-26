//! The sign-in through the OpenID Connect provider: the authorization code flow with PKCE, a `state` and a `nonce`,
//! and the ID token checked against the provider's keys.

mod http_client;

use std::error::Error as StdError;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hangar_api::CookieCredential;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreClientAuthMethod, CoreJwsSigningAlgorithm,
    CoreProviderMetadata,
};
use openidconnect::{
    AuthType, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope, TokenResponse,
};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use url::Url;

use super::cookies::{Cookies, ServerCookie};
use crate::OidcSettings;
use http_client::HttpClient;

/// The client of the provider once discovered: its authorization endpoint set, its token endpoint as it says.
type ProviderClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// A call to the provider that failed, or an answer of its that does not hold.
#[derive(Debug, thiserror::Error)]
#[error("{action}")]
pub(crate) struct OidcError {
    /// What failed.
    action: &'static str,
    /// Why.
    #[source]
    source: Option<Box<dyn StdError + Send + Sync>>,
}

impl OidcError {
    /// `action` failed for `source`.
    fn new(action: &'static str, source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self {
        Self {
            action,
            source: Some(source.into()),
        }
    }

    /// `action` failed, for no error of a library's.
    fn alone(action: &'static str) -> Self {
        Self {
            action,
            source: None,
        }
    }

    /// The error and its causes, each after a `: `, for the log.
    pub(crate) fn describe(&self) -> String {
        let mut message = self.to_string();
        let mut source = StdError::source(self);

        while let Some(cause) = source {
            message.push_str(": ");
            message.push_str(&cause.to_string());
            source = cause.source();
        }

        message
    }
}

/// The provider, discovered again at each sign-in: a sign-in is rare, and its keys, which a provider rotates, are
/// always its current ones.
#[derive(Debug)]
pub(crate) struct Oidc {
    settings: OidcSettings,
    http: HttpClient,
}

/// Who the provider says signed in, once their ID token is checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Identity {
    /// The subject, `sub`: the provider's id of the user, which never changes.
    pub(crate) subject: String,
    /// The email, when the provider says it verified it; `None` when it gives none, or one it did not verify.
    pub(crate) verified_email: Option<String>,
}

/// The sign-in under way, which its cookie holds, encrypted, from the redirect to the provider to the callback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Flow {
    /// The `state` sent to the provider, which must come back with the code: a callback that another browser's
    /// sign-in started is refused.
    state: String,
    /// The `nonce` sent to the provider, which the ID token must hold: a token of another sign-in is refused.
    nonce: String,
    /// The PKCE verifier, whose challenge went to the provider: only who started the sign-in can exchange its code.
    verifier: String,
    /// When the flow expires, in seconds since the epoch.
    expires: u64,
}

impl Flow {
    /// How long the user has to sign in at the provider.
    const LIFETIME: Duration = Duration::from_secs(10 * 60);

    /// The `Set-Cookie` of the flow.
    pub(crate) fn cookie(&self, cookies: &Cookies) -> String {
        cookies.private(ServerCookie::OidcFlow, self, Self::LIFETIME)
    }

    /// The flow the cookie of `credential` holds, if this key encrypted it.
    pub(crate) fn open(cookies: &Cookies, credential: &CookieCredential) -> Option<Self> {
        cookies.open_private(ServerCookie::OidcFlow, credential)
    }

    /// Whether the flow has expired at `now`.
    pub(crate) fn has_expired(&self, now: SystemTime) -> bool {
        Self::seconds(now) >= self.expires
    }

    /// Whether `state` is the one sent to the provider, compared in constant time.
    pub(crate) fn has_state(&self, state: &str) -> bool {
        self.state.as_bytes().ct_eq(state.as_bytes()).into()
    }

    /// `time` in whole seconds since the epoch; 0 before it.
    fn seconds(time: SystemTime) -> u64 {
        time.duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs())
    }
}

impl Oidc {
    /// The algorithms an ID token may be signed with: the provider's keys, never the client's secret, nor none.
    const ALGORITHMS: [CoreJwsSigningAlgorithm; 9] = [
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha384,
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha512,
        CoreJwsSigningAlgorithm::RsaSsaPssSha256,
        CoreJwsSigningAlgorithm::RsaSsaPssSha384,
        CoreJwsSigningAlgorithm::RsaSsaPssSha512,
        CoreJwsSigningAlgorithm::EcdsaP256Sha256,
        CoreJwsSigningAlgorithm::EcdsaP384Sha384,
        CoreJwsSigningAlgorithm::EdDsa,
    ];

    /// The provider of `settings`.
    pub(crate) fn new(settings: OidcSettings) -> Self {
        Self {
            settings,
            http: HttpClient::new(),
        }
    }

    /// The issuer, as `HANGAR_OIDC_ISSUER` writes it.
    pub(crate) fn issuer(&self) -> &str {
        &self.settings.issuer
    }

    /// Starts a sign-in at `now`: the provider's URL to send the browser to, and the flow its cookie keeps.
    pub(crate) async fn start(&self, now: SystemTime) -> Result<(Url, Flow), OidcError> {
        let client = self.client().await?;
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let (url, state, nonce) = client
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("email".to_owned()))
            .add_scope(Scope::new("profile".to_owned()))
            .set_pkce_challenge(challenge)
            .url();
        let flow = Flow {
            state: state.secret().clone(),
            nonce: nonce.secret().clone(),
            verifier: verifier.secret().clone(),
            expires: Flow::seconds(now + Flow::LIFETIME),
        };

        Ok((url, flow))
    }

    /// Ends the sign-in of `flow`: exchanges `code` for the tokens, with the PKCE verifier, and checks the ID token,
    /// its signature, issuer, audience, expiry and nonce.
    pub(crate) async fn finish(&self, flow: &Flow, code: String) -> Result<Identity, OidcError> {
        let client = self.client().await?;
        let token = client
            .exchange_code(AuthorizationCode::new(code))
            .map_err(|error| OidcError::new("the provider has no token endpoint", error))?
            .set_pkce_verifier(PkceCodeVerifier::new(flow.verifier.clone()))
            .request_async(&self.http)
            .await
            .map_err(|error| OidcError::new("the provider refused the code", error))?;
        let id_token = token
            .id_token()
            .ok_or_else(|| OidcError::alone("the provider answered no ID token"))?;
        let verifier = client
            .id_token_verifier()
            .set_allowed_algs(Self::ALGORITHMS);
        let claims = id_token
            .claims(&verifier, &Nonce::new(flow.nonce.clone()))
            .map_err(|error| OidcError::new("the ID token does not hold", error))?;
        let verified_email = claims
            .email()
            .filter(|_| claims.email_verified() == Some(true))
            .map(|email| email.as_str().to_owned());

        Ok(Identity {
            subject: claims.subject().as_str().to_owned(),
            verified_email,
        })
    }

    /// The client of the provider, from its discovery document and its keys.
    async fn client(&self) -> Result<ProviderClient, OidcError> {
        let issuer = IssuerUrl::new(self.settings.issuer.clone())
            .map_err(|error| OidcError::new("the issuer is not a URL", error))?;
        let metadata = CoreProviderMetadata::discover_async(issuer, &self.http)
            .await
            .map_err(|error| OidcError::new("the provider's discovery failed", error))?;
        let auth_type = Self::auth_type(&metadata);
        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(self.settings.client_id.clone()),
            self.settings
                .client_secret
                .as_ref()
                .map(|secret| ClientSecret::new(secret.expose().to_owned())),
        )
        .set_redirect_uri(RedirectUrl::from_url(self.settings.redirect_url.clone()))
        .set_auth_type(auth_type);

        Ok(client)
    }

    /// How the client's secret goes to the token endpoint: in the body when the provider takes it there and not by
    /// HTTP Basic, which is the default.
    fn auth_type(metadata: &CoreProviderMetadata) -> AuthType {
        let Some(methods) = metadata.token_endpoint_auth_methods_supported() else {
            return AuthType::BasicAuth;
        };
        let takes_basic = methods.contains(&CoreClientAuthMethod::ClientSecretBasic);
        let takes_post = methods.contains(&CoreClientAuthMethod::ClientSecretPost);

        if takes_post && !takes_basic {
            return AuthType::RequestBody;
        }

        AuthType::BasicAuth
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use hangar_api::CookieCredential;

    use super::{Cookies, Flow};

    fn flow(now: SystemTime) -> Flow {
        Flow {
            state: "the state".to_owned(),
            nonce: "the nonce".to_owned(),
            verifier: "the verifier".to_owned(),
            expires: Flow::seconds(now + Flow::LIFETIME),
        }
    }

    #[test]
    fn keeps_the_flow_encrypted_for_ten_minutes() {
        let cookies = Cookies::new("0123456789abcdef0123456789abcdef", true);
        let now = SystemTime::now();
        let set_cookie = flow(now).cookie(&cookies);
        let cookie = cookie::Cookie::parse(set_cookie).expect("a cookie");

        assert_eq!(cookie.name(), "__Host-hangar-oidc");
        assert_eq!(cookie.max_age(), Some(cookie::time::Duration::minutes(10)));
        assert!(!cookie.value().contains("verifier"));

        let credential = CookieCredential {
            https: Some(cookie.value().to_owned()),
            http: None,
        };
        let opened = Flow::open(&cookies, &credential).expect("opened");

        assert_eq!(opened, flow(now));
        assert!(!opened.has_expired(now + Duration::from_secs(9 * 60)));
        assert!(opened.has_expired(now + Duration::from_secs(10 * 60)));
    }

    #[test]
    fn checks_the_state() {
        let flow = flow(SystemTime::now());

        assert!(flow.has_state("the state"));
        assert!(!flow.has_state("the stat"));
        assert!(!flow.has_state(""));
    }
}
