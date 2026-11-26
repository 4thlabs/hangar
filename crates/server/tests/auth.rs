//! Signing in by password, served on port 0 and called by reqwest: the session's cookie, what it lets through, and
//! what refuses it.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use cookie::{Cookie, CookieJar, Key};
use hangar_core::{DataDir, PasswordHash};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE, WWW_AUTHENTICATE};
use serde_json::{Value, json};

const SECRET: &str = "0123456789abcdef0123456789abcdef";
const URL: &str = "https://hangar.example.com";
const SESSION: &str = "__Host-hangar-session";

/// A data directory whose `hangar.yml` lists Ana, with a password, and Bo, with none.
fn data_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let hash = PasswordHash::new("correct horse").expect("hashed");

    write_config(
        dir.path(),
        &format!(
            "categories: []\nusers:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n  - {{ name: Bo, email: bo@example.com }}\n"
        ),
    );
    dir
}

/// Writes `source` to the `hangar.yml` of the data directory at `root`.
fn write_config(root: &Path, source: &str) {
    let data_dir = DataDir::new(root).expect("a data directory");
    let file = data_dir.config_file();

    std::fs::create_dir_all(file.parent().expect("a folder")).expect("created");
    std::fs::write(file, source).expect("written");
}

/// Serves the server of the data directory at `root` on port 0, and gives its URL.
async fn serve(root: &Path) -> String {
    serve_at(root, URL).await
}

/// Serves the server of the data directory at `root`, its page at `page_url`, on port 0, and gives its URL.
async fn serve_at(root: &Path, page_url: &str) -> String {
    let page_url = page_url.to_owned();
    let root = root.to_str().expect("a UTF-8 path").to_owned();
    let settings = Settings::read(|name| match name {
        "HANGAR_DATA_DIR" => Some(root.clone()),
        "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
        "DOMAIN" => Some("example.com".to_owned()),
        "HANGAR_URL" => Some(page_url.clone()),
        "HANGAR_SECRET" => Some(SECRET.to_owned()),
        _ => None,
    })
    .expect("the settings are valid");
    let router =
        hangar_server::server(&settings).into_router(hangar_server::router(App::new(&settings)));

    quoll::test::spawn(router).await
}

/// Signs in with `email` and `password`, from the page's origin.
async fn login(url: &str, email: &str, password: &str) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{url}/api/auth/login"))
        .header(ORIGIN, URL)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await
        .expect("the server answers")
}

/// The `Cookie` header of the session `response` sets.
fn session_of(response: &reqwest::Response) -> String {
    let set_cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|value| value.to_str().expect("text"))
        .find(|value| value.starts_with(SESSION))
        .expect("the answer sets the session's cookie");
    let cookie = Cookie::parse(set_cookie).expect("a cookie");

    format!("{}={}", cookie.name(), cookie.value())
}

/// `GET /api/auth/session` with the `Cookie` header `cookie`.
async fn session(url: &str, cookie: &str) -> reqwest::Response {
    reqwest::Client::new()
        .get(format!("{url}/api/auth/session"))
        .header(COOKIE, cookie)
        .send()
        .await
        .expect("the server answers")
}

/// The length of the signature that prefixes the value of a cookie the `cookie` crate signs: a base64 HMAC-SHA256.
const SIGNATURE_LENGTH: usize = 44;

/// The session's cookie `real` with what it holds changed by `change`, then signed with `secret`, as the server
/// signs one: the test needs to know only the times of the session, not how its other fields are made.
fn forged(real: &str, secret: &str, change: impl FnOnce(&mut Value)) -> String {
    let value = real
        .strip_prefix(&format!("{SESSION}="))
        .expect("the session's cookie");
    let payload = URL_SAFE_NO_PAD
        .decode(&value[SIGNATURE_LENGTH..])
        .expect("base64url");
    let mut held: Value = serde_json::from_slice(&payload).expect("JSON");

    change(&mut held[1]);

    let mut jar = CookieJar::new();

    jar.signed_mut(&Key::derive_from(secret.as_bytes()))
        .add(Cookie::new(
            SESSION,
            URL_SAFE_NO_PAD.encode(held.to_string()),
        ));

    format!("{SESSION}={}", jar.get(SESSION).expect("signed").value())
}

/// Seconds since the epoch, `offset` seconds from now.
fn epoch(offset: i64) -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("after the epoch")
        .as_secs();

    i64::try_from(now).expect("a time") + offset
}

const HOUR: i64 = 60 * 60;
const DAY: i64 = 24 * HOUR;

#[tokio::test]
async fn a_user_signs_in_with_their_password_and_their_session_names_them() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    let signed_in = login(&url, "ANA@example.com", "correct horse").await;

    assert_eq!(signed_in.status(), StatusCode::OK);

    let cookie = session_of(&signed_in);
    let set_cookie = signed_in.headers()[SET_COOKIE]
        .to_str()
        .expect("text")
        .to_owned();

    assert_eq!(
        signed_in.json::<Value>().await.expect("JSON"),
        json!({ "name": "Ana", "email": "ana@example.com" })
    );

    for attribute in [
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
        "Max-Age=604800",
    ] {
        assert!(set_cookie.contains(attribute), "{set_cookie}");
    }

    let current = session(&url, &cookie).await;

    assert_eq!(current.status(), StatusCode::OK);
    assert!(
        current.headers().get(SET_COOKIE).is_none(),
        "a new session is not renewed"
    );
    assert_eq!(
        current.json::<Value>().await.expect("JSON"),
        json!({ "name": "Ana", "email": "ana@example.com" })
    );
}

#[tokio::test]
async fn a_wrong_password_an_unknown_email_and_a_user_without_one_are_refused_alike() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    for (email, password) in [
        ("ana@example.com", "wrong horse"),
        ("cy@example.com", "correct horse"),
        ("bo@example.com", "correct horse"),
    ] {
        let refused = login(&url, email, password).await;

        assert_eq!(refused.status(), StatusCode::UNAUTHORIZED, "{email}");
        assert!(refused.headers().get(SET_COOKIE).is_none(), "{email}");
        assert_eq!(refused.headers()[CONTENT_TYPE], "application/problem+json");
        assert_eq!(
            refused.json::<Value>().await.expect("JSON")["detail"],
            "invalid email or password"
        );
    }
}

#[tokio::test]
async fn ten_failures_refuse_an_email_for_a_while() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    for _ in 0..10 {
        assert_eq!(
            login(&url, "ana@example.com", "wrong horse").await.status(),
            StatusCode::UNAUTHORIZED
        );
    }

    let limited = login(&url, "ana@example.com", "correct horse").await;

    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        limited.json::<Value>().await.expect("JSON")["detail"],
        "too many failed sign-ins for this email: try again in 15 min"
    );
}

#[tokio::test]
async fn at_most_ten_of_many_sign_ins_sent_at_once_reach_the_password_check() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let attempts = (0..50).map(|_| login(&url, "ana@example.com", "wrong horse"));
    let statuses: Vec<StatusCode> = futures::future::join_all(attempts)
        .await
        .iter()
        .map(reqwest::Response::status)
        .collect();
    let checked = statuses
        .iter()
        .filter(|status| **status == StatusCode::UNAUTHORIZED)
        .count();
    let refused = statuses
        .iter()
        .filter(|status| **status == StatusCode::TOO_MANY_REQUESTS)
        .count();

    assert_eq!((checked, refused), (10, 40), "{statuses:?}");
}

#[tokio::test]
async fn an_email_longer_than_any_user_s_is_refused_before_it_is_counted() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let long = format!("{}@example.com", "a".repeat(250));

    for _ in 0..20 {
        assert_eq!(
            login(&url, &long, "correct horse").await.status(),
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn a_body_past_16_kib_is_refused_on_the_routes_of_signing_in() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let password = "a".repeat(32 * 1024);

    let refused = login(&url, "ana@example.com", &password).await;

    assert_eq!(refused.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn nobody_signs_in_while_a_user_of_hangar_yml_is_wrong() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let hash = PasswordHash::new("correct horse").expect("hashed");

    write_config(
        dir.path(),
        &format!(
            "categories: []\nusers:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n  - {{ name: Bo, email: bo }}\n"
        ),
    );

    assert_eq!(
        login(&url, "ana@example.com", "correct horse")
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_route_that_takes_a_session_answers_401_in_the_api_s_shape_without_one() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    let response = reqwest::get(format!("{url}/api/auth/session"))
        .await
        .expect("the server answers");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response.headers()[CONTENT_TYPE], "application/problem+json");
    assert!(response.headers().contains_key(WWW_AUTHENTICATE));
}

#[tokio::test]
async fn a_tampered_cookie_or_one_of_another_secret_is_refused() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let cookie = session_of(&login(&url, "ana@example.com", "correct horse").await);
    let tampered = cookie.replacen("hangar-session=", "hangar-session=A", 1);
    let other_secret = forged(&cookie, "another secret, of at least 32 bytes", |_| {});

    for cookie in [tampered, other_secret] {
        let refused = session(&url, &cookie).await;

        assert_eq!(refused.status(), StatusCode::UNAUTHORIZED, "{cookie}");
        assert_eq!(
            refused.json::<Value>().await.expect("JSON")["detail"],
            "the session is not valid or has expired: sign in again"
        );
    }
}

#[tokio::test]
async fn an_expired_session_is_refused_and_one_a_day_old_renewed() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let cookie = session_of(&login(&url, "ana@example.com", "correct horse").await);
    let expired = forged(&cookie, SECRET, |held| held["expires"] = json!(epoch(-1)));
    let a_day_old = forged(&cookie, SECRET, |held| {
        held["issued"] = json!(epoch(-25 * HOUR));
        held["expires"] = json!(epoch(7 * DAY - 25 * HOUR));
    });

    assert_eq!(
        session(&url, &expired).await.status(),
        StatusCode::UNAUTHORIZED
    );

    let renewed = session(&url, &a_day_old).await;

    assert_eq!(renewed.status(), StatusCode::OK);
    assert!(
        renewed.headers()[SET_COOKIE]
            .to_str()
            .expect("text")
            .contains("Max-Age=604800")
    );
}

#[tokio::test]
async fn a_session_ends_thirty_days_after_the_sign_in_whatever_its_renewals() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let cookie = session_of(&login(&url, "ana@example.com", "correct horse").await);
    let renewed_for_a_month = forged(&cookie, SECRET, |held| {
        held["issued"] = json!(epoch(-30 * DAY));
        held["expires"] = json!(epoch(HOUR));
    });
    let nearly_a_month = forged(&cookie, SECRET, |held| {
        held["issued"] = json!(epoch(-29 * DAY));
        held["expires"] = json!(epoch(HOUR));
    });

    assert_eq!(
        session(&url, &renewed_for_a_month).await.status(),
        StatusCode::UNAUTHORIZED
    );

    let last_renewal = session(&url, &nearly_a_month).await;
    let set_cookie = last_renewal.headers()[SET_COOKIE]
        .to_str()
        .expect("text")
        .to_owned();
    let max_age = Cookie::parse(set_cookie)
        .expect("a cookie")
        .max_age()
        .expect("a Max-Age")
        .whole_seconds();

    assert_eq!(last_renewal.status(), StatusCode::OK);
    assert!(
        (DAY - 60..=DAY).contains(&max_age),
        "renewed up to the thirtieth day alone: {max_age}"
    );
}

#[tokio::test]
async fn a_change_of_password_ends_the_sessions_opened_before() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let cookie = session_of(&login(&url, "ana@example.com", "correct horse").await);
    let hash = PasswordHash::new("another horse").expect("hashed");

    write_config(
        dir.path(),
        &format!(
            "categories: []\nusers:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n"
        ),
    );

    let refused = session(&url, &cookie).await;

    assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        refused.json::<Value>().await.expect("JSON")["detail"],
        "the user's credentials have changed: sign in again"
    );
    assert_eq!(
        login(&url, "ana@example.com", "another horse")
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_user_removed_from_hangar_yml_is_signed_out() {
    let dir = data_dir();
    let url = serve(dir.path()).await;
    let cookie = session_of(&login(&url, "ana@example.com", "correct horse").await);

    write_config(
        dir.path(),
        "categories: []\nusers:\n  - { name: Bo, email: bo@example.com }\n",
    );

    let refused = session(&url, &cookie).await;

    assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        refused.json::<Value>().await.expect("JSON")["detail"],
        "the session's user is no longer in hangar.yml"
    );
}

#[tokio::test]
async fn signing_out_clears_the_cookie() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    let response = reqwest::Client::new()
        .post(format!("{url}/api/auth/logout"))
        .header(ORIGIN, URL)
        .send()
        .await
        .expect("the server answers");
    let set_cookie = response.headers()[SET_COOKIE].to_str().expect("text");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(
        set_cookie.starts_with(&format!("{SESSION}=;")),
        "{set_cookie}"
    );
    assert!(set_cookie.contains("Max-Age=0"), "{set_cookie}");
}

#[tokio::test]
async fn a_post_from_another_origin_is_refused_before_it_signs_in() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    let refused = reqwest::Client::new()
        .post(format!("{url}/api/auth/login"))
        .header(ORIGIN, "https://evil.example.com")
        .json(&json!({ "email": "ana@example.com", "password": "correct horse" }))
        .send()
        .await
        .expect("the server answers");

    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    assert!(refused.headers().get(SET_COOKIE).is_none());
    assert_eq!(
        refused.json::<Value>().await.expect("JSON")["detail"],
        "the request comes from another origin than https://hangar.example.com"
    );
}

#[tokio::test]
async fn the_options_say_no_provider_is_configured_and_its_routes_are_404() {
    let dir = data_dir();
    let url = serve(dir.path()).await;

    let options = reqwest::get(format!("{url}/api/auth/options"))
        .await
        .expect("the server answers");
    let oidc = reqwest::get(format!("{url}/api/auth/oidc/login"))
        .await
        .expect("the server answers");

    assert_eq!(
        options.json::<Value>().await.expect("JSON"),
        json!({ "oidc": false })
    );
    assert_eq!(oidc.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn over_plain_http_the_session_is_neither_secure_nor_prefixed() {
    let dir = data_dir();
    let url = serve_at(dir.path(), "http://hangar.lan:3010").await;
    let over_https = serve(dir.path()).await;

    let signed_in = reqwest::Client::new()
        .post(format!("{url}/api/auth/login"))
        .header(ORIGIN, "http://hangar.lan:3010")
        .json(&json!({ "email": "ana@example.com", "password": "correct horse" }))
        .send()
        .await
        .expect("the server answers");
    let set_cookie = signed_in.headers()[SET_COOKIE]
        .to_str()
        .expect("text")
        .to_owned();
    let cookie = Cookie::parse(set_cookie.clone()).expect("a cookie");
    let plain = format!("{}={}", cookie.name(), cookie.value());

    assert_eq!(cookie.name(), "hangar-session");
    assert!(!set_cookie.contains("Secure"), "{set_cookie}");
    assert!(
        set_cookie.contains("HttpOnly") && set_cookie.contains("SameSite=Lax"),
        "{set_cookie}"
    );
    assert_eq!(session(&url, &plain).await.status(), StatusCode::OK);

    let prefixed = session_of(&login(&over_https, "ana@example.com", "correct horse").await);

    assert_eq!(
        session(&url, &prefixed).await.status(),
        StatusCode::UNAUTHORIZED,
        "a cookie of the other scheme is no session"
    );
    assert_eq!(
        session(&over_https, &plain).await.status(),
        StatusCode::UNAUTHORIZED
    );
}
