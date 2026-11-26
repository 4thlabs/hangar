//! Signing in through an OpenID Connect provider faked on port 0: its discovery document, its keys, and a token
//! endpoint that checks the client, the PKCE verifier and the redirect, and signs the ID token of the grant a test
//! gives it.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::extract::{Form, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use cookie::Cookie;
use ed25519_dalek::SigningKey;
use ed25519_dalek::pkcs8::EncodePrivateKey;
use ed25519_dalek::pkcs8::spki::der::pem::LineEnding;
use hangar_core::DataDir;
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{COOKIE, LOCATION, SET_COOKIE};
use openidconnect::core::{
    CoreEdDsaPrivateSigningKey, CoreIdToken, CoreIdTokenClaims, CoreJsonWebKeySet,
    CoreJwsSigningAlgorithm,
};
use openidconnect::{
    Audience, EmptyAdditionalClaims, EndUserEmail, IssuerUrl, JsonWebKeyId, Nonce,
    PrivateSigningKey, StandardClaims, SubjectIdentifier,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;

const CLIENT_ID: &str = "hangar";
const CLIENT_SECRET: &str = "the client's secret";
const URL: &str = "https://hangar.example.com";
const CALLBACK_PATH: &str = "/api/auth/oidc/callback";

/// Who the provider says signs in with a code.
#[derive(Debug, Clone)]
struct Grant {
    subject: &'static str,
    email: &'static str,
    email_verified: bool,
}

/// What the provider knows of a code it handed out: the grant, and the nonce and the challenge of its sign-in.
#[derive(Debug, Clone)]
struct Issued {
    grant: Grant,
    nonce: String,
    challenge: String,
    redirect_uri: String,
}

/// The fake provider: its issuer, its key, the codes it handed out, and how many times it was discovered.
#[derive(Clone)]
struct Provider {
    issuer: String,
    key: Arc<Mutex<Arc<CoreEdDsaPrivateSigningKey>>>,
    codes: Arc<Mutex<HashMap<String, Issued>>>,
    discoveries: Arc<AtomicUsize>,
    expired_tokens: Arc<AtomicBool>,
}

/// The form of a token request.
#[derive(Debug, Deserialize)]
struct TokenRequest {
    grant_type: String,
    code: String,
    redirect_uri: String,
    code_verifier: String,
}

impl Provider {
    /// Serves a provider on port 0.
    async fn serve() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bound");
        let issuer = format!("http://{}", listener.local_addr().expect("an address"));
        let provider = Self {
            issuer,
            key: Arc::new(Mutex::new(Self::key(7))),
            codes: Arc::default(),
            discoveries: Arc::default(),
            expired_tokens: Arc::default(),
        };
        let router = Router::new()
            .route("/.well-known/openid-configuration", get(Self::discovery))
            .route("/jwks", get(Self::jwks))
            .route("/token", post(Self::token))
            .with_state(provider.clone());

        tokio::spawn(async move { axum::serve(listener, router).await });
        provider
    }

    /// The signing key made of the bytes `seed`, named after them.
    fn key(seed: u8) -> Arc<CoreEdDsaPrivateSigningKey> {
        let pem = SigningKey::from_bytes(&[seed; 32])
            .to_pkcs8_pem(LineEnding::LF)
            .expect("a PEM");
        let key = CoreEdDsaPrivateSigningKey::from_ed25519_pem(
            &pem,
            Some(JsonWebKeyId::new(format!("key-{seed}"))),
        )
        .expect("an Ed25519 key");

        Arc::new(key)
    }

    /// Replaces the provider's key with another, as a provider rotates its keys: the old one is no longer published.
    fn rotate_key(&self, seed: u8) {
        *self.key.lock().expect("no test panics with the lock") = Self::key(seed);
    }

    /// The provider's current key.
    fn current_key(&self) -> Arc<CoreEdDsaPrivateSigningKey> {
        Arc::clone(&self.key.lock().expect("no test panics with the lock"))
    }

    /// Hands out `code` for `grant`, to the sign-in whose authorization URL is `authorize`.
    fn hand_out(&self, code: &str, authorize: &Url, grant: Grant) {
        let query: HashMap<String, String> = authorize.query_pairs().into_owned().collect();

        assert_eq!(query["client_id"], CLIENT_ID);
        assert!(
            query["redirect_uri"].ends_with(CALLBACK_PATH),
            "{}",
            query["redirect_uri"]
        );
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["code_challenge_method"], "S256");
        assert!(query["scope"].split(' ').any(|scope| scope == "openid"));

        self.codes
            .lock()
            .expect("no test panics with the lock")
            .insert(
                code.to_owned(),
                Issued {
                    grant,
                    nonce: query["nonce"].clone(),
                    challenge: query["code_challenge"].clone(),
                    redirect_uri: query["redirect_uri"].clone(),
                },
            );
    }

    async fn discovery(State(provider): State<Self>) -> Json<Value> {
        let issuer = &provider.issuer;

        provider.discoveries.fetch_add(1, Ordering::SeqCst);

        Json(json!({
            "issuer": issuer,
            "authorization_endpoint": format!("{issuer}/authorize"),
            "token_endpoint": format!("{issuer}/token"),
            "jwks_uri": format!("{issuer}/jwks"),
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["EdDSA"],
            "token_endpoint_auth_methods_supported": ["client_secret_basic"],
        }))
    }

    async fn jwks(State(provider): State<Self>) -> Json<CoreJsonWebKeySet> {
        Json(CoreJsonWebKeySet::new(vec![
            provider.current_key().as_verification_key(),
        ]))
    }

    async fn token(
        State(provider): State<Self>,
        headers: HeaderMap,
        Form(request): Form<TokenRequest>,
    ) -> Response {
        let basic = format!(
            "Basic {}",
            STANDARD.encode(format!("{CLIENT_ID}:{}", Self::form_encoded(CLIENT_SECRET)))
        );
        let is_client = headers
            .get("authorization")
            .is_some_and(|value| value == basic.as_str());
        let issued = provider
            .codes
            .lock()
            .expect("no test panics with the lock")
            .remove(&request.code);
        let Some(issued) =
            issued.filter(|_| is_client && request.grant_type == "authorization_code")
        else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_grant" })),
            )
                .into_response();
        };
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(request.code_verifier.as_bytes()));

        if challenge != issued.challenge || request.redirect_uri != issued.redirect_uri {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_grant" })),
            )
                .into_response();
        }

        Json(json!({
            "access_token": "an access token",
            "token_type": "Bearer",
            "expires_in": 300,
            "id_token": provider.id_token(&issued),
        }))
        .into_response()
    }

    /// The ID token of `issued`, signed with the provider's key.
    fn id_token(&self, issued: &Issued) -> CoreIdToken {
        let now = chrono::Utc::now();
        let now = if self.expired_tokens.load(Ordering::SeqCst) {
            now - chrono::Duration::hours(1)
        } else {
            now
        };
        let claims = CoreIdTokenClaims::new(
            IssuerUrl::new(self.issuer.clone()).expect("a URL"),
            vec![Audience::new(CLIENT_ID.to_owned())],
            now + chrono::Duration::minutes(5),
            now,
            StandardClaims::new(SubjectIdentifier::new(issued.grant.subject.to_owned()))
                .set_email(Some(EndUserEmail::new(issued.grant.email.to_owned())))
                .set_email_verified(Some(issued.grant.email_verified)),
            EmptyAdditionalClaims {},
        )
        .set_nonce(Some(Nonce::new(issued.nonce.clone())));

        CoreIdToken::new(
            claims,
            self.current_key().as_ref(),
            CoreJwsSigningAlgorithm::EdDsa,
            None,
            None,
        )
        .expect("signed")
    }

    /// `text` as `application/x-www-form-urlencoded` writes it, as OAuth 2.0 encodes the client's credentials.
    fn form_encoded(text: &str) -> String {
        url::form_urlencoded::byte_serialize(text.as_bytes()).collect()
    }
}

/// A data directory whose `hangar.yml` lists Ana by email, and Bo by subject.
fn data_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let data_dir = DataDir::new(dir.path()).expect("a data directory");
    let file = data_dir.config_file();

    std::fs::create_dir_all(file.parent().expect("a folder")).expect("created");
    std::fs::write(
        file,
        "categories: []\nusers:\n  - { name: Ana, email: ana@example.com }\n  - { name: Bo, email: bo@example.com, oidcSubject: bo-at-the-provider }\n",
    )
    .expect("written");
    dir
}

/// Serves the server of the data directory at `root`, signing in through `provider`, on port 0.
async fn serve(root: &Path, provider: &Provider) -> String {
    serve_at(root, provider, URL).await
}

/// Serves the server of the data directory at `root`, its page at `page_url`, signing in through `provider`, on
/// port 0.
async fn serve_at(root: &Path, provider: &Provider, page_url: &str) -> String {
    let page_url = page_url.to_owned();
    let root = root.to_str().expect("a UTF-8 path").to_owned();
    let issuer = provider.issuer.clone();
    let settings = Settings::read(|name| match name {
        "HANGAR_DATA_DIR" => Some(root.clone()),
        "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
        "DOMAIN" => Some("example.com".to_owned()),
        "HANGAR_URL" => Some(page_url.clone()),
        "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
        "HANGAR_OIDC_ISSUER" => Some(issuer.clone()),
        "HANGAR_OIDC_CLIENT_ID" => Some(CLIENT_ID.to_owned()),
        "HANGAR_OIDC_CLIENT_SECRET" => Some(CLIENT_SECRET.to_owned()),
        _ => None,
    })
    .expect("the settings are valid");
    let router = hangar_server::server(&settings)
        .into_router(hangar_server::router(App::new(&settings, docker()).await));

    quoll::test::spawn(router).await
}

/// A client that reads redirects rather than follow them.
fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("a client")
}

/// The cookie `name` that `response` sets, as a `Cookie` header sends it back; `None` when it sets none, or clears it.
fn cookie(response: &reqwest::Response, name: &str) -> Option<String> {
    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| Cookie::parse(value.to_str().ok()?.to_owned()).ok())
        .find(|cookie| cookie.name() == name && !cookie.value().is_empty())
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
}

/// The redirect of `response`.
fn location(response: &reqwest::Response) -> String {
    response.headers()[LOCATION]
        .to_str()
        .expect("text")
        .to_owned()
}

/// A sign-in started at the server of `url`: the provider's authorization URL, and the flow's cookie.
async fn start(url: &str) -> (Url, String) {
    let started = http()
        .get(format!("{url}/api/auth/oidc/login"))
        .send()
        .await
        .expect("the server answers");

    assert_eq!(started.status(), StatusCode::SEE_OTHER);

    let flow = cookie(&started, "__Host-hangar-oidc")
        .or_else(|| cookie(&started, "hangar-oidc"))
        .expect("the flow's cookie");
    let authorize = Url::parse(&location(&started)).expect("a URL");

    (authorize, flow)
}

/// The state of the authorization URL `authorize`.
fn state(authorize: &Url) -> String {
    authorize
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, state)| state.into_owned())
        .expect("a state")
}

/// The callback of the provider to the server of `url`, with `code`, `state` and the `Cookie` header `cookie`.
async fn callback(url: &str, code: &str, state: &str, cookie: &str) -> reqwest::Response {
    http()
        .get(format!("{url}/api/auth/oidc/callback"))
        .query(&[("code", code), ("state", state)])
        .header(COOKIE, cookie)
        .send()
        .await
        .expect("the server answers")
}

#[tokio::test]
async fn a_user_hangar_yml_references_by_verified_email_signs_in() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;
    let (authorize, flow) = start(&url).await;

    assert!(
        authorize
            .as_str()
            .starts_with(&format!("{}/authorize?", provider.issuer))
    );

    provider.hand_out(
        "code-ana",
        &authorize,
        Grant {
            subject: "ana-at-the-provider",
            email: "Ana@Example.com",
            email_verified: true,
        },
    );

    let signed_in = callback(&url, "code-ana", &state(&authorize), &flow).await;

    assert_eq!(signed_in.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&signed_in), "/");

    let session = cookie(&signed_in, "__Host-hangar-session").expect("the session's cookie");

    assert!(
        cookie(&signed_in, "__Host-hangar-oidc").is_none(),
        "the flow's cookie is cleared"
    );

    let user: Value = http()
        .get(format!("{url}/api/auth/session"))
        .header(COOKIE, session)
        .send()
        .await
        .expect("the server answers")
        .json()
        .await
        .expect("JSON");

    assert_eq!(user, json!({ "name": "Ana", "email": "ana@example.com" }));
}

#[tokio::test]
async fn a_user_with_a_subject_signs_in_by_it_alone() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;
    let (by_subject, flow) = start(&url).await;

    provider.hand_out(
        "code-bo",
        &by_subject,
        Grant {
            subject: "bo-at-the-provider",
            email: "bo@elsewhere.example",
            email_verified: false,
        },
    );

    let signed_in = callback(&url, "code-bo", &state(&by_subject), &flow).await;

    assert_eq!(location(&signed_in), "/");

    let (by_email, flow) = start(&url).await;

    provider.hand_out(
        "code-not-bo",
        &by_email,
        Grant {
            subject: "someone-else",
            email: "bo@example.com",
            email_verified: true,
        },
    );

    let refused = callback(&url, "code-not-bo", &state(&by_email), &flow).await;

    assert_eq!(
        location(&refused),
        "/login?error=not-a-user",
        "Bo's email is not Bo's subject"
    );
}

#[tokio::test]
async fn anyone_hangar_yml_does_not_reference_is_refused() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;

    for (code, grant) in [
        (
            "code-cy",
            Grant {
                subject: "cy-at-the-provider",
                email: "cy@example.com",
                email_verified: true,
            },
        ),
        (
            "code-unverified",
            Grant {
                subject: "who-claims-ana",
                email: "ana@example.com",
                email_verified: false,
            },
        ),
    ] {
        let (authorize, flow) = start(&url).await;

        provider.hand_out(code, &authorize, grant);

        let refused = callback(&url, code, &state(&authorize), &flow).await;

        assert_eq!(refused.status(), StatusCode::SEE_OTHER, "{code}");
        assert_eq!(location(&refused), "/login?error=not-a-user", "{code}");
        assert!(
            cookie(&refused, "__Host-hangar-session").is_none(),
            "{code}"
        );
    }
}

#[tokio::test]
async fn a_callback_of_another_sign_in_or_without_its_cookie_is_refused() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;
    let ana = Grant {
        subject: "ana-at-the-provider",
        email: "ana@example.com",
        email_verified: true,
    };
    let (authorize, flow) = start(&url).await;
    let (_, other_flow) = start(&url).await;

    provider.hand_out("code-ana", &authorize, ana);

    let wrong_state = callback(&url, "code-ana", "another state", &flow).await;
    let other_cookie = callback(&url, "code-ana", &state(&authorize), &other_flow).await;
    let no_cookie = callback(&url, "code-ana", &state(&authorize), "").await;
    let tampered = callback(&url, "code-ana", &state(&authorize), &format!("{flow}A")).await;

    for refused in [wrong_state, other_cookie, no_cookie, tampered] {
        assert_eq!(location(&refused), "/login?error=expired");
        assert!(cookie(&refused, "__Host-hangar-session").is_none());
    }
}

#[tokio::test]
async fn a_code_the_provider_refuses_or_a_declined_sign_in_ends_on_the_login_page() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;
    let (authorize, flow) = start(&url).await;

    let unknown_code = callback(&url, "a code never handed out", &state(&authorize), &flow).await;
    let declined = http()
        .get(format!("{url}/api/auth/oidc/callback"))
        .query(&[("error", "access_denied"), ("state", &state(&authorize))])
        .header(COOKIE, &flow)
        .send()
        .await
        .expect("the server answers");

    assert_eq!(location(&unknown_code), "/login?error=unavailable");
    assert_eq!(location(&declined), "/login?error=denied");
}

#[tokio::test]
async fn a_provider_that_cannot_be_reached_sends_the_browser_back_to_the_login_page() {
    let provider = Provider {
        issuer: "http://127.0.0.1:9".to_owned(),
        ..Provider::serve().await
    };
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;

    let started = http()
        .get(format!("{url}/api/auth/oidc/login"))
        .send()
        .await
        .expect("the server answers");
    let options: Value = reqwest::get(format!("{url}/api/auth/options"))
        .await
        .expect("the server answers")
        .json()
        .await
        .expect("JSON");

    assert_eq!(location(&started), "/login?error=unavailable");
    assert_eq!(options, json!({ "oidc": true }));
}

#[tokio::test]
async fn over_plain_http_the_cookies_are_neither_secure_nor_prefixed() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve_at(dir.path(), &provider, "http://hangar.lan:3010").await;
    let (authorize, flow) = start(&url).await;

    assert!(flow.starts_with("hangar-oidc="), "{flow}");

    provider.hand_out(
        "code-ana",
        &authorize,
        Grant {
            subject: "ana-at-the-provider",
            email: "ana@example.com",
            email_verified: true,
        },
    );

    let signed_in = callback(&url, "code-ana", &state(&authorize), &flow).await;
    let set_cookies: Vec<&str> = signed_in
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|value| value.to_str().expect("text"))
        .collect();

    assert_eq!(location(&signed_in), "/");
    assert!(
        set_cookies
            .iter()
            .all(|set_cookie| !set_cookie.contains("Secure")),
        "{set_cookies:?}"
    );

    let session = cookie(&signed_in, "hangar-session").expect("the session's cookie");
    let user: Value = http()
        .get(format!("{url}/api/auth/session"))
        .header(COOKIE, session)
        .send()
        .await
        .expect("the server answers")
        .json()
        .await
        .expect("JSON");

    assert_eq!(user, json!({ "name": "Ana", "email": "ana@example.com" }));
}

/// Ana, as the provider signs her in.
fn ana() -> Grant {
    Grant {
        subject: "ana-at-the-provider",
        email: "ana@example.com",
        email_verified: true,
    }
}

#[tokio::test]
async fn the_provider_is_discovered_once_for_many_sign_ins() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;

    for index in 0..3 {
        let (authorize, flow) = start(&url).await;
        let code = format!("code-{index}");

        provider.hand_out(&code, &authorize, ana());

        assert_eq!(
            location(&callback(&url, &code, &state(&authorize), &flow).await),
            "/"
        );
    }

    let starts = (0..20).map(|_| http().get(format!("{url}/api/auth/oidc/login")).send());

    futures::future::join_all(starts).await;

    assert_eq!(provider.discoveries.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn an_expired_token_is_refused_without_discovering_the_provider_anew() {
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;
    let (authorize, flow) = start(&url).await;

    provider.expired_tokens.store(true, Ordering::SeqCst);
    provider.hand_out("code-ana", &authorize, ana());

    let refused = callback(&url, "code-ana", &state(&authorize), &flow).await;

    assert_eq!(location(&refused), "/login?error=unavailable");
    assert_eq!(provider.discoveries.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_burst_of_tokens_of_a_key_just_rotated_in_does_not_discover_the_provider_again_and_again()
{
    let provider = Provider::serve().await;
    let dir = data_dir();
    let url = serve(dir.path(), &provider).await;
    let mut started = Vec::new();

    for _ in 0..5 {
        started.push(start(&url).await);
    }

    provider.rotate_key(8);

    for (index, (authorize, _)) in started.iter().enumerate() {
        provider.hand_out(&format!("code-{index}"), authorize, ana());
    }

    let callbacks = started
        .iter()
        .enumerate()
        .map(|(index, (authorize, flow))| {
            let code = format!("code-{index}");
            let state = state(authorize);
            let url = url.clone();

            async move { callback(&url, &code, &state, flow).await }
        });
    let answers = futures::future::join_all(callbacks).await;

    // The keys were discovered at the first start, less than thirty seconds ago: they are kept, and the tokens of
    // the new key refused, until the pause has passed.
    for answer in &answers {
        assert_eq!(location(answer), "/login?error=unavailable");
    }

    assert_eq!(provider.discoveries.load(Ordering::SeqCst), 1);
}

/// A client of no daemon: these tests call no Docker route.
fn docker() -> hangar_core::Docker {
    hangar_core::Docker::with_host("tcp://127.0.0.1:9").expect("a client")
}
