//! The widgets' routes, served on port 0 and called with a session by the client of the contract and by reqwest, on
//! fake services served on port 0 too, whose answers each test writes.

mod arcane;
mod backrest;
mod beszel;
mod finnhub;
mod forgejo;
mod frigate;
mod github;
mod gluetun;
mod jellyfin;
mod miniflux;
mod tcg_collector;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::HeaderMap;
use cookie::Cookie;
use hangar_api::Widgets as _;
use hangar_api::{Api, ApiClient, ErrorCode, Session, WidgetPlacement};
use hangar_core::{Docker, PasswordHash};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{COOKIE, ORIGIN, SET_COOKIE};
use serde_json::{Value, json};

const URL: &str = "https://hangar.example.com";

/// A data directory whose store's `hangar.yml` places the widgets a test writes, its apps and its `.env.global`.
struct Fixture {
    _dir: tempfile::TempDir,
    data: PathBuf,
}

impl Fixture {
    /// A store whose `hangar.yml` places `widgets`, the lines of its `widgets:`, and signs Ana in.
    fn new(widgets: &str) -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data = dir.path().join("data");
        let store = data.join("app-store");

        fs::create_dir_all(store.join(".git")).expect("created");
        fs::create_dir_all(store.join("config")).expect("created");
        fs::create_dir_all(store.join("store")).expect("created");

        let hash = PasswordHash::new("correct horse").expect("hashed");

        fs::write(
            store.join("config/hangar.yml"),
            format!(
                "categories: []\nusers:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n\
                 widgets:\n{widgets}"
            ),
        )
        .expect("written");

        Self { _dir: dir, data }
    }

    /// Adds the app `id` to the store, its `compose.yml` holding `compose`.
    fn app(&self, id: &str, compose: &str) -> &Self {
        let folder = self.data.join("app-store/store").join(id);

        fs::create_dir_all(&folder).expect("created");
        fs::write(folder.join("compose.yml"), compose).expect("written");

        self
    }

    /// Writes `.env.global`.
    fn env(&self, variables: &str) -> &Self {
        fs::write(self.data.join(".env.global"), variables).expect("written");

        self
    }

    /// The server, served on port 0, with Ana signed in.
    async fn serve(&self) -> Server {
        self.serve_with(&[], |_| ()).await
    }

    /// The server of the settings that `variables` add to the environment and that `change` makes, served on port 0,
    /// with Ana signed in.
    async fn serve_with(
        &self,
        variables: &[(&str, &str)],
        change: impl FnOnce(&mut Settings),
    ) -> Server {
        let data = self.data.to_str().expect("UTF-8").to_owned();
        let mut settings = Settings::read(|name| match name {
            "HANGAR_DATA_DIR" => Some(data.clone()),
            "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
            "DOMAIN" => Some("example.com".to_owned()),
            "HANGAR_URL" => Some(URL.to_owned()),
            "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
            other => variables
                .iter()
                .find(|(variable, _)| *variable == other)
                .map(|(_, value)| (*value).to_owned()),
        })
        .expect("the settings are valid");

        change(&mut settings);

        // No widget asks the daemon: Docker's stats are read from the Docker routes.
        let docker = Docker::with_host("tcp://127.0.0.1:9").expect("a client");
        let app = App::new(&settings, docker).await;
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

        assert_eq!(cookie.name(), Session::HTTPS_COOKIE);

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
    /// The client of the contract, with the session.
    fn api(&self) -> ApiClient {
        let cookie = self.cookie.clone();

        quoll::client::builder()
            .with(quoll::client::on_request(move |request, _| {
                request
                    .headers_mut()
                    .insert(COOKIE, cookie.parse().expect("a header's value"));
            }))
            .build::<Api>(&self.url)
            .expect("a client")
    }

    /// The placements, in their order.
    async fn placements(&self) -> Vec<WidgetPlacement> {
        self.api()
            .widgets()
            .placements()
            .await
            .expect("the placements")
    }

    /// The key of the placement of `widget`, its `type`, the first one.
    async fn key(&self, widget: &str) -> String {
        self.placements()
            .await
            .into_iter()
            .find(|placement| serde_json::to_value(placement.widget).expect("JSON") == widget)
            .unwrap_or_else(|| panic!("{widget} is placed"))
            .key
    }

    /// `GET path`'s status, headers and body.
    async fn get(&self, path: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
        let response = reqwest::Client::new()
            .get(format!("{}{path}", self.url))
            .header(COOKIE, &self.cookie)
            .send()
            .await
            .expect("the server answers");
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.bytes().await.expect("a body").to_vec();

        (status, headers, body)
    }

    /// The code of the problem `GET path` answers, and its status.
    async fn problem(&self, path: &str) -> (StatusCode, Option<String>) {
        let (status, _, body) = self.get(path).await;
        let problem: Value = serde_json::from_slice(&body).expect("a problem");
        let code = problem["type"]
            .as_str()
            .and_then(|kind| kind.strip_prefix(ErrorCode::PROBLEM_TYPE_PREFIX))
            .map(str::to_owned);

        (status, code)
    }
}

/// How many times a fake service was called.
#[derive(Debug, Clone, Default)]
struct Calls(Arc<AtomicUsize>);

impl Calls {
    fn count(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }

    fn get(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

#[tokio::test]
async fn the_widget_routes_take_a_session() {
    let fixture = Fixture::new("  - { type: clock, column: 1 }\n");
    let server = fixture.serve().await;

    for path in [
        "/api/widgets",
        "/api/widgets/clock-1",
        "/api/widgets/clock-1/image/a",
    ] {
        let response = reqwest::get(format!("{}{path}", server.url))
            .await
            .expect("the server answers");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn lists_the_placements_in_their_order_with_their_column_and_link() {
    let fixture = Fixture::new(
        "  - { type: clock, column: 1 }\n  - { type: frigate-events, column: 3 }\n  - { type: frigate-events, \
         column: 2, link: 'https://cameras.example.com' }\n  - { type: github-releases, column: 2, repositories: \
         [4thlabs/hangar] }\n",
    );

    fixture.app(
        "frigate",
        "services:\n  frigate:\n    image: frigate\n    container_name: frigate-nvr\n",
    );

    let placements = fixture.serve().await.placements().await;
    let summary: Vec<_> = placements
        .iter()
        .map(|placement| {
            (
                serde_json::to_value(placement.widget).expect("JSON"),
                placement.column,
                placement.link.as_deref(),
            )
        })
        .collect();

    assert_eq!(
        summary,
        [
            (json!("clock"), 1, None),
            (
                json!("frigate-events"),
                3,
                Some("https://frigate-nvr.example.com")
            ),
            (
                json!("frigate-events"),
                2,
                Some("https://cameras.example.com")
            ),
            (json!("github-releases"), 2, None),
        ]
    );
    assert!(placements[1].key.starts_with("frigate-events-"));
    assert_ne!(placements[1].key, placements[2].key);
}

#[tokio::test]
async fn answers_404_for_a_key_placed_nowhere_or_that_of_a_widget_that_loads_nothing() {
    let fixture = Fixture::new(
        "  - { type: clock, column: 1 }\n  - { type: docker-general-stats, column: 1 }\n",
    );
    let server = fixture.serve().await;
    let placements = server.placements().await;

    for key in [
        "frigate-events-1".to_owned(),
        placements[0].key.clone(),
        placements[1].key.clone(),
    ] {
        assert_eq!(
            server.problem(&format!("/api/widgets/{key}")).await,
            (
                StatusCode::NOT_FOUND,
                Some("widgets.unknown_placement".to_owned())
            ),
            "{key}"
        );
    }
}
