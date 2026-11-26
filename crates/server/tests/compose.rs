//! The compose routes, served on port 0 and called with a session by the client of the contract and by reqwest: their
//! batches run a fake `docker` first in the runtime's `PATH`, and read again a fake daemon, served on port 0 too.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::routing::get;
use cookie::Cookie;
use futures::{Stream, StreamExt};
use hangar_api::Compose as _;
use hangar_api::Docker as _;
use hangar_api::{
    Api, ApiClient, ComposeAction, ComposeEvent, ComposeOutcome, ComposeRequest, ComposeStatus,
    ErrorCode, ErrorDetail,
};
use hangar_core::{Docker, PasswordHash, Runtime};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{COOKIE, ORIGIN, SET_COOKIE};
use serde_json::{Value, json};

const URL: &str = "https://hangar.example.com";

/// How long a test waits for what it checks before it fails.
const PATIENCE: Duration = Duration::from_secs(30);

/// The fake `docker`: it logs its arguments, one call per line, and prints two lines on stderr, where compose writes its
/// progress. Between them, it holds the project that `HANGAR_TEST_HOLD` names until the file `HANGAR_TEST_RELEASE`
/// exists, its child's wait and not the test's, and fails with code 1 on the one `HANGAR_TEST_FAIL` names.
const FAKE_DOCKER: &str = r#"#!/bin/sh
echo "$*" >> "$HANGAR_TEST_LOG"
project=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "-p" ]; then project="$arg"; fi
  previous="$arg"
done
echo "$project: working" >&2
if [ "$project" = "${HANGAR_TEST_HOLD:-none}" ]; then
  while [ ! -e "$HANGAR_TEST_RELEASE" ]; do sleep 0.01; done
fi
if [ "$project" = "${HANGAR_TEST_FAIL:-none}" ]; then echo "$project: no such image" >&2; exit 1; fi
echo " Container $project-web-1  Started" >&2
"#;

/// A daemon of no container, which counts how many times it listed them; its events never come.
#[derive(Default)]
struct FakeDaemon {
    lists: AtomicUsize,
}

impl FakeDaemon {
    /// Serves the daemon on port 0; the URL of `DOCKER_HOST`.
    async fn serve() -> (Arc<Self>, String) {
        let daemon = Arc::new(Self::default());
        let router = axum::Router::new()
            .route("/v1.44/containers/json", get(Self::list))
            .route("/v1.44/events", get(futures::future::pending::<()>))
            .with_state(Arc::clone(&daemon));
        let url = quoll::test::spawn(router).await;

        (daemon, url.replace("http://", "tcp://"))
    }

    async fn list(State(daemon): State<Arc<Self>>) -> Json<Vec<Value>> {
        daemon.lists.fetch_add(1, Ordering::SeqCst);

        Json(Vec::new())
    }

    fn lists(&self) -> usize {
        self.lists.load(Ordering::SeqCst)
    }
}

/// A data directory with a store of three apps, `alpha` and `gamma` installed, `beta` not, `hangar.yml` listing
/// `gamma` before `alpha`; the fake `docker`, and the log of its calls.
struct Fixture {
    dir: tempfile::TempDir,
    data: PathBuf,
    log: PathBuf,
    release: PathBuf,
}

/// What the fake `docker` of a server does.
#[derive(Default)]
struct Behaviour {
    /// The app it fails on.
    fail: Option<&'static str>,
    /// The app it holds until released.
    hold: Option<&'static str>,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data = dir.path().join("data");
        let store = data.join("app-store");
        let bin = dir.path().join("bin");

        fs::create_dir_all(store.join(".git")).expect("created");
        fs::create_dir_all(store.join("config")).expect("created");
        fs::create_dir_all(data.join("app-installed")).expect("created");

        for app in ["alpha", "beta", "gamma"] {
            let folder = store.join("store").join(app);

            fs::create_dir_all(&folder).expect("created");
            fs::write(
                folder.join("compose.yml"),
                "services:\n  web:\n    image: nginx\n",
            )
            .expect("written");
        }

        for app in ["alpha", "gamma"] {
            std::os::unix::fs::symlink(
                store.join("store").join(app),
                data.join("app-installed").join(app),
            )
            .expect("linked");
        }

        let hash = PasswordHash::new("correct horse").expect("hashed");

        fs::write(
            store.join("config/hangar.yml"),
            format!(
                "categories:\n  - {{ name: Apps, color: blue, stacks: [gamma, alpha] }}\nusers:\n  - {{ name: Ana, \
                 email: ana@example.com, passwordHash: '{hash}' }}\n"
            ),
        )
        .expect("written");
        fs::create_dir_all(&bin).expect("created");
        fs::write(bin.join("docker"), FAKE_DOCKER).expect("written");
        fs::set_permissions(bin.join("docker"), fs::Permissions::from_mode(0o755))
            .expect("made executable");

        Self {
            log: dir.path().join("docker.log"),
            release: dir.path().join("release"),
            dir,
            data,
        }
    }

    /// The calls of the fake `docker`, one per line.
    fn docker_calls(&self) -> Vec<String> {
        fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// The project of each call of the fake `docker`, in order.
    fn projects(&self) -> Vec<String> {
        self.docker_calls()
            .iter()
            .map(|call| {
                let words: Vec<&str> = call.split(' ').collect();
                let at = words
                    .iter()
                    .position(|word| *word == "-p")
                    .expect("a project");

                words[at + 1].to_owned()
            })
            .collect()
    }

    /// Lets the app the fake `docker` holds end.
    fn release(&self) {
        fs::write(&self.release, "").expect("written");
    }

    /// Serves the server on port 0, on the daemon of `docker_host`, its `docker` the fake one doing as `behaviour`
    /// says; and signs Ana in.
    async fn serve(&self, docker_host: &str, behaviour: Behaviour) -> Server {
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
        let path = std::env::var("PATH").unwrap_or_default();
        let bin = self.dir.path().join("bin");
        let runtime = Runtime::new().envs([
            ("PATH", format!("{}:{path}", bin.display())),
            ("HANGAR_TEST_LOG", self.log.display().to_string()),
            (
                "HANGAR_TEST_FAIL",
                behaviour.fail.unwrap_or("none").to_owned(),
            ),
            (
                "HANGAR_TEST_HOLD",
                behaviour.hold.unwrap_or("none").to_owned(),
            ),
            ("HANGAR_TEST_RELEASE", self.release.display().to_string()),
        ]);
        let docker = Docker::with_host(docker_host).expect("a client");
        let app = App::with_runtime(&settings, runtime, docker).await;
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

    /// `POST /api/docker/compose` with `body`, its status and JSON, for a batch refused.
    async fn refused(&self, body: &Value) -> (StatusCode, Value) {
        let response = reqwest::Client::new()
            .post(format!("{}/api/docker/compose", self.url))
            .header(COOKIE, &self.cookie)
            .header(ORIGIN, URL)
            .json(body)
            .send()
            .await
            .expect("the server answers");
        let status = response.status();

        (status, response.json().await.expect("JSON"))
    }
}

/// A batch of `action` over `apps`.
fn request(action: ComposeAction, apps: &[&str]) -> ComposeRequest {
    ComposeRequest {
        action,
        apps: apps.iter().map(|app| (*app).to_owned()).collect(),
    }
}

/// `up -d --pull always`.
fn update() -> ComposeAction {
    ComposeAction::Up {
        pull: true,
        force_recreate: false,
    }
}

/// What `future` gives, within [`PATIENCE`].
async fn within<T>(what: &str, future: impl Future<Output = T>) -> T {
    tokio::time::timeout(PATIENCE, future)
        .await
        .unwrap_or_else(|_| panic!("{what} did not come within {PATIENCE:?}"))
}

/// Every event of `events`, to its end.
async fn all<S>(events: S) -> Vec<ComposeEvent>
where
    S: Stream<Item = quoll::Result<ComposeEvent>>,
{
    within(
        "the end of the batch",
        events.map(|event| event.expect("an event")).collect(),
    )
    .await
}

/// The next event of `events`.
async fn next<S>(events: &mut S) -> ComposeEvent
where
    S: Stream<Item = quoll::Result<ComposeEvent>> + Unpin,
{
    within("an event", events.next())
        .await
        .expect("the stream goes on")
        .expect("an event")
}

fn succeeded(app: &str) -> ComposeOutcome {
    ComposeOutcome {
        app: app.to_owned(),
        status: ComposeStatus::Succeeded,
        error: None,
    }
}

fn line(app: &str, line: &str) -> ComposeEvent {
    ComposeEvent::Line {
        app: app.to_owned(),
        line: line.to_owned(),
    }
}

fn started(app: &str) -> ComposeEvent {
    ComposeEvent::Started {
        app: app.to_owned(),
    }
}

/// The events of an app the fake `docker` succeeded on.
fn ran(app: &str) -> Vec<ComposeEvent> {
    vec![
        started(app),
        line(app, &format!("{app}: working")),
        line(app, &format!(" Container {app}-web-1  Started")),
        ComposeEvent::Finished(succeeded(app)),
    ]
}

#[tokio::test]
async fn the_compose_routes_take_a_session() {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let server = fixture.serve(&docker_host, Behaviour::default()).await;
    let client = reqwest::Client::new();

    for (method, path) in [
        (reqwest::Method::POST, "/api/docker/compose"),
        (reqwest::Method::GET, "/api/docker/compose"),
        (reqwest::Method::GET, "/api/docker/compose/1"),
    ] {
        let response = client
            .request(method, format!("{}{path}", server.url))
            .header(ORIGIN, URL)
            .json(&json!({ "action": { "operation": "restart" }, "apps": ["alpha"] }))
            .send()
            .await
            .expect("the server answers");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }

    assert!(fixture.docker_calls().is_empty(), "docker never ran");
}

#[tokio::test]
async fn runs_up_on_each_app_in_the_order_of_hangar_yml_and_ends_with_the_report()
-> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let server = fixture.serve(&docker_host, Behaviour::default()).await;

    let events = all(server
        .api()
        .compose()
        .run(&request(update(), &["alpha", "gamma", "alpha"]))
        .await?)
    .await;

    let mut expected = ran("gamma");

    expected.extend(ran("alpha"));
    expected.push(ComposeEvent::End(hangar_api::ComposeReport {
        apps: vec![succeeded("gamma"), succeeded("alpha")],
    }));

    assert_eq!(events, expected);
    assert_eq!(fixture.projects(), ["gamma", "alpha"], "each app once");
    assert!(
        fixture.docker_calls()[0].ends_with("up -d --pull always"),
        "{:?}",
        fixture.docker_calls()
    );
    Ok(())
}

#[tokio::test]
async fn takes_the_apps_down_in_reverse() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let server = fixture.serve(&docker_host, Behaviour::default()).await;

    all(server
        .api()
        .compose()
        .run(&request(ComposeAction::Down, &["gamma", "alpha"]))
        .await?)
    .await;

    assert_eq!(fixture.projects(), ["alpha", "gamma"]);
    assert!(
        fixture
            .docker_calls()
            .iter()
            .all(|call| call.ends_with(" down"))
    );
    Ok(())
}

#[tokio::test]
async fn carries_on_after_an_app_that_fails_and_says_why_without_its_output() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let behaviour = Behaviour {
        fail: Some("gamma"),
        ..Behaviour::default()
    };
    let server = fixture.serve(&docker_host, behaviour).await;

    let events = all(server
        .api()
        .compose()
        .run(&request(ComposeAction::Restart, &["alpha", "gamma"]))
        .await?)
    .await;

    let failed = ComposeOutcome {
        app: "gamma".to_owned(),
        status: ComposeStatus::Failed,
        error: Some(ErrorDetail::from(ErrorCode::ComposeFailed {
            app: "gamma".to_owned(),
            command: "docker compose restart".to_owned(),
        })),
    };

    assert_eq!(
        events[..4],
        [
            started("gamma"),
            line("gamma", "gamma: working"),
            line("gamma", "gamma: no such image"),
            ComposeEvent::Finished(failed.clone()),
        ]
    );
    assert_eq!(
        events.last(),
        Some(&ComposeEvent::End(hangar_api::ComposeReport {
            apps: vec![failed, succeeded("alpha")],
        }))
    );
    assert_eq!(fixture.projects(), ["gamma", "alpha"]);
    Ok(())
}

#[tokio::test]
async fn refuses_a_batch_with_an_app_it_cannot_run_and_runs_none() {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let server = fixture.serve(&docker_host, Behaviour::default()).await;
    let restart = json!({ "operation": "restart" });

    let (status, problem) = server
        .refused(&json!({ "action": restart, "apps": ["alpha", "llama.cpp"] }))
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(problem["type"], "/problems/docker.invalid_project");
    assert_eq!(problem["project"], "llama.cpp");

    let (status, problem) = server
        .refused(&json!({ "action": restart, "apps": ["alpha", "beta"] }))
        .await;

    assert_eq!(status, StatusCode::NOT_FOUND, "beta is not installed");
    assert_eq!(problem["type"], "/problems/docker.unknown_project");
    assert_eq!(problem["project"], "beta");

    let (status, problem) = server
        .refused(&json!({ "action": restart, "apps": [] }))
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(problem["type"], "/problems/compose.no_apps");

    assert!(fixture.docker_calls().is_empty(), "docker never ran");
}

#[tokio::test]
async fn a_page_that_comes_back_reads_a_running_batch_from_its_start() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let behaviour = Behaviour {
        hold: Some("alpha"),
        ..Behaviour::default()
    };
    let server = fixture.serve(&docker_host, behaviour).await;
    let api = server.api();

    let mut first = api
        .compose()
        .run(&request(update(), &["alpha", "gamma"]))
        .await?;

    for event in ran("gamma") {
        assert_eq!(next(&mut first).await, event);
    }

    assert_eq!(next(&mut first).await, started("alpha"));
    drop(first);

    let batches = api.compose().batches().await?;

    assert_eq!(batches.len(), 1);
    assert_eq!(
        batches[0].command_line,
        "docker compose up -d --pull always"
    );
    assert_eq!(batches[0].apps, ["gamma", "alpha"]);
    assert_eq!(batches[0].action, update());
    assert_eq!(batches[0].report, None, "it runs");

    let mut again = api.compose().output(batches[0].id).await?;

    for event in ran("gamma") {
        assert_eq!(next(&mut again).await, event, "from its start");
    }

    assert_eq!(next(&mut again).await, started("alpha"));
    assert_eq!(next(&mut again).await, line("alpha", "alpha: working"));

    fixture.release();

    let rest = all(again).await;
    let report = hangar_api::ComposeReport {
        apps: vec![succeeded("gamma"), succeeded("alpha")],
    };

    assert_eq!(rest.last(), Some(&ComposeEvent::End(report.clone())));
    assert_eq!(
        api.compose().batches().await?[0].report,
        Some(report),
        "kept once ended"
    );
    Ok(())
}

#[tokio::test]
async fn a_batch_that_is_not_kept_is_a_404() {
    let fixture = Fixture::new();
    let (_, docker_host) = FakeDaemon::serve().await;
    let server = fixture.serve(&docker_host, Behaviour::default()).await;

    let error = server
        .api()
        .compose()
        .output(7)
        .await
        .expect_err("no batch 7");

    assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
    assert_eq!(
        ErrorCode::read(&error),
        Some(ErrorCode::UnknownBatch { batch: 7 })
    );
}

#[tokio::test]
async fn reads_the_containers_again_before_the_end_of_a_batch() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (daemon, docker_host) = FakeDaemon::serve().await;
    let server = fixture.serve(&docker_host, Behaviour::default()).await;
    let api = server.api();

    api.docker().projects().await?;

    assert_eq!(daemon.lists(), 1);

    all(api
        .compose()
        .run(&request(ComposeAction::Restart, &["alpha", "gamma"]))
        .await?)
    .await;

    assert_eq!(daemon.lists(), 3, "once after each app");
    Ok(())
}
