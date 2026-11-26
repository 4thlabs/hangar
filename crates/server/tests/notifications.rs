//! The notifications' routes, served on port 0 and called with a session by the client of the contract: a notification
//! filed by a store sync that fails, pushed to the stream, listed, marked, and given again to a stream from before it.

#![cfg(unix)]

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use cookie::Cookie;
use futures::{Stream, StreamExt};
use hangar_api::{
    Api, ApiClient, Notification, NotificationLevel, NotificationMessage, SeenNotifications,
};
use hangar_api::{Notifications as _, Store as _};
use hangar_core::PasswordHash;
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{COOKIE, ORIGIN, SET_COOKIE};
use serde_json::json;

const URL: &str = "https://hangar.example.com";

/// How long a test waits for what it checks before it fails.
const PATIENCE: Duration = Duration::from_secs(30);

/// A data directory whose store is "cloned", an empty `.git` that a pull fails on, and whose `hangar.yml` lets Ana
/// sign in.
struct Fixture {
    _dir: tempfile::TempDir,
    data: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data = dir.path().join("data");
        let store = data.join("app-store");
        let hash = PasswordHash::new("correct horse").expect("hashed");

        fs::create_dir_all(store.join(".git")).expect("created");
        fs::create_dir_all(store.join("config")).expect("created");
        fs::write(
            store.join("config/hangar.yml"),
            format!(
                "users:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n"
            ),
        )
        .expect("written");

        Self { _dir: dir, data }
    }

    /// A server of the data directory, served on port 0, and Ana signed in.
    async fn serve(&self) -> Server {
        let data = self.data.to_str().expect("UTF-8").to_owned();
        let settings = Settings::read(|name| match name {
            "HANGAR_DATA_DIR" => Some(data.clone()),
            "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
            "DOMAIN" => Some("example.com".to_owned()),
            "HANGAR_URL" => Some(URL.to_owned()),
            "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
            _ => None,
        })
        .expect("the settings are valid");
        let docker = hangar_core::Docker::with_host("tcp://127.0.0.1:9").expect("a client");
        let app = App::new(&settings, docker);
        let router = hangar_server::server(&settings).into_router(hangar_server::router(app));
        let url = quoll::test::spawn(router).await;
        let login = reqwest::Client::new()
            .post(format!("{url}/api/auth/login"))
            .header(ORIGIN, URL)
            .json(&json!({ "email": "ana@example.com", "password": "correct horse" }))
            .send()
            .await
            .expect("the server answers");
        let set_cookie = login
            .headers()
            .get(SET_COOKIE)
            .expect("the session's cookie")
            .to_str()
            .expect("text");
        let cookie = Cookie::parse(set_cookie).expect("a cookie");

        Server {
            url,
            cookie: format!("{}={}", cookie.name(), cookie.value()),
        }
    }
}

/// The server of a test, and the session of its user.
struct Server {
    url: String,
    cookie: String,
}

impl Server {
    /// The client of the contract, with the session, from the page's origin.
    fn api(&self) -> ApiClient {
        let cookie = self.cookie.clone();

        quoll::client::builder()
            .with(quoll::client::on_request(move |request, _| {
                let headers = request.headers_mut();

                headers.insert(COOKIE, cookie.parse().expect("a header's value"));
                headers.insert(ORIGIN, URL.parse().expect("a header's value"));
            }))
            .build::<Api>(&self.url)
            .expect("a client")
    }
}

/// The next item of `stream`, within [`PATIENCE`].
async fn next<S: Stream + Unpin>(what: &str, stream: &mut S) -> S::Item {
    tokio::time::timeout(PATIENCE, stream.next())
        .await
        .unwrap_or_else(|_| panic!("{what} did not come within {PATIENCE:?}"))
        .unwrap_or_else(|| panic!("the stream ended before {what}"))
}

/// What the list says of each notification: its id, whether it was seen and read.
fn marks(notifications: &[Notification]) -> Vec<(u64, bool, bool)> {
    notifications
        .iter()
        .map(|notification| (notification.id, notification.seen, notification.read))
        .collect()
}

#[tokio::test]
async fn the_notifications_routes_take_a_session() {
    let fixture = Fixture::new();
    let server = fixture.serve().await;

    for path in ["/api/notifications", "/api/notifications/events"] {
        let response = reqwest::get(format!("{}{path}", server.url))
            .await
            .expect("the server answers");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn a_sync_s_end_is_pushed_listed_marked_and_given_again_from_a_since() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let server = fixture.serve().await;
    let api = server.api();

    assert_eq!(api.notifications().list().await?, []);

    let mut events = api.notifications().events(None).await?;

    api.store().sync().await?;

    let failed = next("the sync's end", &mut events).await?;

    assert_eq!(failed.id, 1);
    assert_eq!(failed.level, NotificationLevel::Error);
    assert_eq!(failed.message, NotificationMessage::StoreUpdateFailed);
    assert_eq!(failed.href.as_deref(), Some("/settings"));
    assert_eq!(api.notifications().list().await?, [failed]);

    api.notifications()
        .seen(&SeenNotifications { ids: vec![1] })
        .await?;
    api.notifications().read().await?;

    assert_eq!(marks(&api.notifications().list().await?), [(1, true, true)]);

    let mut from_before = api.notifications().events(Some(0)).await?;

    assert_eq!(
        next("the one filed before", &mut from_before).await?.id,
        1,
        "a page that comes back gets what it missed"
    );
    Ok(())
}
