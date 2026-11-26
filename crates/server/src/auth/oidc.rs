//! The sign-in through the OpenID Connect provider: the authorization code flow with PKCE, a `state` and a `nonce`,
//! and the ID token checked against the provider's keys.

mod http_client;

use std::error::Error as StdError;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hangar_api::CookieCredential;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreClientAuthMethod, CoreIdToken, CoreJwsSigningAlgorithm,
    CoreProviderMetadata,
};
use openidconnect::{
    AuthType, AuthorizationCode, ClaimsVerificationError, ClientId, ClientSecret, CsrfToken,
    EndpointMaybeSet, EndpointNotSet, EndpointSet, IssuerUrl, Nonce, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, SignatureVerificationError, TokenResponse,
};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;
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

/// The provider, its discovery document and its keys kept five minutes.
///
/// The sign-in's start needs no session: discovering at each one would let a loop of requests make the server call
/// the provider as often. One discovery runs at a time, the others waiting for its answer, and it is kept five
/// minutes. An ID token whose signature the kept keys refuse, as after the provider rotated its keys, is checked again
/// once against keys discovered anew, unless the kept ones are less than thirty seconds old.
#[derive(Debug)]
pub(crate) struct Oidc {
    settings: OidcSettings,
    http: HttpClient,
    discovered: Mutex<Option<Discovered>>,
}

/// The client of the provider, and when its discovery answered.
#[derive(Debug)]
struct Discovered {
    client: ProviderClient,
    at: Instant,
}

impl Discovered {
    /// How long a discovery is kept.
    const FRESHNESS: Duration = Duration::from_secs(5 * 60);
    /// How long after a discovery the keys are not discovered anew, even for a token they refuse: a burst of
    /// callbacks signed with a key the provider just rotated in causes one discovery, not one each.
    const REDISCOVERY_PAUSE: Duration = Duration::from_secs(30);

    /// Whether the kept discovery serves a call that asks `refresh` at `now`.
    fn serves(&self, refresh: Refresh, now: Instant) -> bool {
        let age = now.saturating_duration_since(self.at);

        match refresh {
            Refresh::IfStale => age < Self::FRESHNESS,
            Refresh::Now => age < Self::REDISCOVERY_PAUSE,
        }
    }
}

/// Whether the kept discovery of the provider may be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refresh {
    /// Kept while it is fresh.
    IfStale,
    /// Discovered anew, as the keys kept refused a token's signature, unless the kept one has just been discovered.
    Now,
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

    /// How long a discovery may take, the lock held: past it, the requests waiting for it get an error, and the
    /// discovery kept, if any, stays.
    const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);

    /// The provider of `settings`.
    pub(crate) fn new(settings: OidcSettings) -> Self {
        Self {
            settings,
            http: HttpClient::new(),
            discovered: Mutex::new(None),
        }
    }

    /// The issuer, as `HANGAR_OIDC_ISSUER` writes it.
    pub(crate) fn issuer(&self) -> &str {
        &self.settings.issuer
    }

    /// Starts a sign-in at `now`: the provider's URL to send the browser to, and the flow its cookie keeps.
    pub(crate) async fn start(&self, now: SystemTime) -> Result<(Url, Flow), OidcError> {
        let client = self.client(Refresh::IfStale).await?;
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
    /// its signature, issuer, audience, expiry and nonce, against the provider's keys discovered anew when the kept
    /// ones refuse it.
    pub(crate) async fn finish(&self, flow: &Flow, code: String) -> Result<Identity, OidcError> {
        let client = self.client(Refresh::IfStale).await?;
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
        let nonce = Nonce::new(flow.nonce.clone());

        match Self::identity(&client, id_token, &nonce) {
            Ok(identity) => return Ok(identity),
            Err(error) if !Self::is_signed_with_other_keys(&error) => {
                return Err(OidcError::new("the ID token does not hold", error));
            }
            Err(_) => {}
        }

        let rediscovered = self.client(Refresh::Now).await?;

        Self::identity(&rediscovered, id_token, &nonce)
            .map_err(|error| OidcError::new("the ID token does not hold", error))
    }

    /// Whether the keys refused the token's signature, as a token signed with a key the provider rotated in: its key
    /// id is none of theirs, or its signature does not check. Any other failure, an expired token, a wrong nonce or
    /// audience, is refused as it is.
    fn is_signed_with_other_keys(error: &ClaimsVerificationError) -> bool {
        matches!(
            error,
            ClaimsVerificationError::SignatureVerification(
                SignatureVerificationError::NoMatchingKey
                    | SignatureVerificationError::CryptoError(_)
            )
        )
    }

    /// Who `id_token` says signed in, once `client`'s keys check it.
    fn identity(
        client: &ProviderClient,
        id_token: &CoreIdToken,
        nonce: &Nonce,
    ) -> Result<Identity, ClaimsVerificationError> {
        let verifier = client
            .id_token_verifier()
            .set_allowed_algs(Self::ALGORITHMS);
        let claims = id_token.claims(&verifier, nonce)?;
        let verified_email = claims
            .email()
            .filter(|_| claims.email_verified() == Some(true))
            .map(|email| email.as_str().to_owned());

        Ok(Identity {
            subject: claims.subject().as_str().to_owned(),
            verified_email,
        })
    }

    /// The client of the provider: the one kept while it serves `refresh`, or else one discovered. The lock is held
    /// across the discovery, so that the callers that wait for it take its answer, and the discovery bounded by
    /// [`DISCOVERY_TIMEOUT`](Self::DISCOVERY_TIMEOUT).
    async fn client(&self, refresh: Refresh) -> Result<ProviderClient, OidcError> {
        let mut discovered = self.discovered.lock().await;
        let kept = discovered
            .as_ref()
            .filter(|kept| kept.serves(refresh, Instant::now()));

        if let Some(kept) = kept {
            return Ok(kept.client.clone());
        }

        let client = tokio::time::timeout(Self::DISCOVERY_TIMEOUT, self.discover())
            .await
            .map_err(|elapsed| {
                OidcError::new("the provider's discovery took longer than 10 s", elapsed)
            })??;

        *discovered = Some(Discovered {
            client: client.clone(),
            at: Instant::now(),
        });

        Ok(client)
    }

    /// The client of the provider, from its discovery document and its keys.
    async fn discover(&self) -> Result<ProviderClient, OidcError> {
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

    use std::time::Instant;

    use openidconnect::core::{
        CoreClient, CoreJwsSigningAlgorithm, CoreProviderMetadata, CoreResponseType,
        CoreSubjectIdentifierType,
    };
    use openidconnect::{
        AuthUrl, ClaimsVerificationError, ClientId, EmptyAdditionalProviderMetadata, IssuerUrl,
        JsonWebKeySetUrl, ResponseTypes, SignatureVerificationError,
    };

    use super::{Cookies, Discovered, Flow, Oidc, Refresh};

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
    fn keeps_a_discovery_five_minutes_and_discovers_anew_past_thirty_seconds() {
        let at = Instant::now();
        let discovered = Discovered {
            client: client(),
            at,
        };
        let second = Duration::from_secs(1);

        assert!(discovered.serves(Refresh::IfStale, at + 299 * second));
        assert!(!discovered.serves(Refresh::IfStale, at + 300 * second));
        assert!(
            discovered.serves(Refresh::Now, at + 29 * second),
            "a burst takes the keys just discovered"
        );
        assert!(!discovered.serves(Refresh::Now, at + 30 * second));
    }

    #[test]
    fn discovers_anew_for_a_signature_alone() {
        let unknown_key = ClaimsVerificationError::SignatureVerification(
            SignatureVerificationError::NoMatchingKey,
        );
        let bad_signature = ClaimsVerificationError::SignatureVerification(
            SignatureVerificationError::CryptoError("bad signature".to_owned()),
        );

        assert!(Oidc::is_signed_with_other_keys(&unknown_key));
        assert!(Oidc::is_signed_with_other_keys(&bad_signature));

        for error in [
            ClaimsVerificationError::Expired("expired".to_owned()),
            ClaimsVerificationError::InvalidNonce("nonce".to_owned()),
            ClaimsVerificationError::InvalidAudience("audience".to_owned()),
            ClaimsVerificationError::SignatureVerification(
                SignatureVerificationError::DisallowedAlg("HS256".to_owned()),
            ),
        ] {
            assert!(!Oidc::is_signed_with_other_keys(&error), "{error:?}");
        }
    }

    /// A client of a provider, as a discovery gives one.
    fn client() -> super::ProviderClient {
        let issuer = IssuerUrl::new("https://auth.example.com".to_owned()).expect("a URL");
        let metadata = CoreProviderMetadata::new(
            issuer,
            AuthUrl::new("https://auth.example.com/authorize".to_owned()).expect("a URL"),
            JsonWebKeySetUrl::new("https://auth.example.com/jwks".to_owned()).expect("a URL"),
            vec![ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            vec![CoreJwsSigningAlgorithm::EdDsa],
            EmptyAdditionalProviderMetadata {},
        );

        CoreClient::from_provider_metadata(metadata, ClientId::new("hangar".to_owned()), None)
    }

    #[test]
    fn checks_the_state() {
        let flow = flow(SystemTime::now());

        assert!(flow.has_state("the state"));
        assert!(!flow.has_state("the stat"));
        assert!(!flow.has_state(""));
    }
}
