//! The Docker routes, served on port 0 and called with a session by the client of the contract and by reqwest, on a
//! fake daemon served on port 0 too, whose containers and events the test writes.

#![cfg(unix)]

use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use cookie::Cookie;
use futures::{Stream, StreamExt, stream};
use hangar_api::Docker as _;
use hangar_api::{
    Api, ApiClient, ContainerHealth, DockerChange, ErrorCode, LogEvent, ProjectStatus, Session,
};
use hangar_core::{Docker, PasswordHash};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{COOKIE, ORIGIN, SET_COOKIE};
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc};

const URL: &str = "https://hangar.example.com";

/// How long a test waits for what it checks before it fails.
const PATIENCE: Duration = Duration::from_secs(30);

/// The full id of the container of `alpha`, which is installed.
fn alpha_id() -> String {
    "a".repeat(64)
}

/// The full id of the container of `beta`, which is not.
fn beta_id() -> String {
    "b".repeat(64)
}

/// A daemon the test writes: its containers, the events it sends on its one connection, and the calls it got.
#[derive(Default)]
struct FakeDaemon {
    containers: Mutex<Vec<Value>>,
    events: Mutex<Option<mpsc::UnboundedReceiver<Value>>>,
    lists: AtomicUsize,
    listed: Notify,
}

impl FakeDaemon {
    /// The list entry of a container of `project`'s service `web`, in `state`.
    fn container(id: &str, project: &str, state: &str) -> Value {
        json!({
            "Id": id,
            "Names": [format!("/{project}-web-1")],
            "Image": "nginx:alpine",
            "ImageID": "sha256:nginx",
            "State": state,
            "Status": "Up 2 minutes",
            "Labels": {
                "com.docker.compose.project": project,
                "com.docker.compose.service": "web",
                "com.docker.compose.container-number": "1",
            },
            "Ports": [{ "IP": "0.0.0.0", "PrivatePort": 80, "PublicPort": 8080, "Type": "tcp" }],
        })
    }

    /// Serves the daemon on port 0, with `alpha` and `beta` running; the URL of `DOCKER_HOST`, and the sender of its
    /// events.
    async fn serve() -> (Arc<Self>, String, mpsc::UnboundedSender<Value>) {
        let (events, receiver) = mpsc::unbounded_channel();
        let daemon = Arc::new(Self {
            containers: Mutex::new(vec![
                Self::container(&alpha_id(), "alpha", "running"),
                Self::container(&beta_id(), "beta", "running"),
            ]),
            events: Mutex::new(Some(receiver)),
            ..Self::default()
        });
        let router = axum::Router::new()
            .route("/v1.44/containers/json", get(Self::list))
            .route("/v1.44/containers/{id}/json", get(Self::inspect))
            .route("/v1.44/containers/{id}/logs", get(Self::logs))
            .route("/v1.44/containers/{id}/stats", get(Self::stats))
            .route("/v1.44/events", get(Self::events))
            .route("/v1.44/info", get(Self::info))
            .route("/v1.44/system/df", get(Self::disk_usage))
            .with_state(Arc::clone(&daemon));
        let url = quoll::test::spawn(router).await;
        let docker_host = url.replace("http://", "tcp://");

        (daemon, docker_host, events)
    }

    /// Sets the state of the container `id`.
    fn set_state(&self, id: &str, state: &str) {
        let mut containers = self
            .containers
            .lock()
            .expect("no test panics with the lock");

        for container in containers
            .iter_mut()
            .filter(|container| container["Id"] == id)
        {
            container["State"] = state.into();
        }
    }

    fn lists(&self) -> usize {
        self.lists.load(Ordering::SeqCst)
    }

    /// Once the daemon has listed its containers `count` times.
    async fn listed(&self, count: usize) {
        within("the lists", async {
            while self.lists() < count {
                self.listed.notified().await;
            }
        })
        .await;
    }

    /// The containers that `filters` keep: by label, `name` or `name=value`, and the running ones unless `all`.
    async fn list(
        State(daemon): State<Arc<Self>>,
        Query(query): Query<HashMap<String, String>>,
    ) -> Json<Vec<Value>> {
        let filters: HashMap<String, Vec<String>> =
            serde_json::from_str(&query["filters"]).expect("the filters are JSON");
        let all = query["all"] == "true";
        let containers = daemon
            .containers
            .lock()
            .expect("no test panics with the lock")
            .clone();
        let kept = containers
            .into_iter()
            .filter(|container| all || container["State"] == "running")
            .filter(|container| {
                filters["label"]
                    .iter()
                    .all(|label| match label.split_once('=') {
                        Some((name, value)) => container["Labels"][name] == value,
                        None => !container["Labels"][label].is_null(),
                    })
            })
            .collect();

        // Counted once answered, which is what a test that awaits a list waits for.
        daemon.lists.fetch_add(1, Ordering::SeqCst);
        daemon.listed.notify_waiters();

        Json(kept)
    }

    async fn inspect(Path(_): Path<String>) -> Json<Value> {
        Json(json!({ "RestartCount": 1, "State": { "Health": { "Status": "healthy" } } }))
    }

    /// Two lines, as a container with a TTY writes them, then the end, as the container stopped.
    async fn logs(Path(_): Path<String>) -> Response {
        let lines = "2026-11-26T10:00:00.000000000Z hello\n2026-11-26T10:00:01.000000000Z world\n";

        ([(CONTENT_TYPE, "application/vnd.docker.raw-stream")], lines).into_response()
    }

    async fn stats(Path(_): Path<String>) -> Json<Value> {
        Json(json!({
            "cpu_stats": { "cpu_usage": { "total_usage": 100 }, "system_cpu_usage": 1_000, "online_cpus": 2 },
            "memory_stats": { "usage": 3_072, "limit": 4_096, "stats": { "inactive_file": 1_024 } },
        }))
    }

    /// The events the test sends, on the first connection; the others wait forever.
    async fn events(State(daemon): State<Arc<Self>>) -> Response {
        let receiver = daemon
            .events
            .lock()
            .expect("no test panics with the lock")
            .take();
        let lines: std::pin::Pin<Box<dyn Stream<Item = Result<String, Infallible>> + Send>> =
            match receiver {
                Some(receiver) => Box::pin(stream::unfold(receiver, |mut receiver| async move {
                    let event = receiver.recv().await?;

                    Some((Ok(format!("{event}\n")), receiver))
                })),
                None => Box::pin(stream::pending()),
            };

        (
            [(CONTENT_TYPE, "application/json")],
            Body::from_stream(lines),
        )
            .into_response()
    }

    async fn info() -> Json<Value> {
        Json(json!({
            "ServerVersion": "29.0.1",
            "Containers": 3,
            "ContainersRunning": 2,
            "ContainersStopped": 1,
            "MemTotal": 16_000,
        }))
    }

    async fn disk_usage() -> Json<Value> {
        Json(json!({
            "LayersSize": 1_000,
            "Images": [{ "Containers": 2 }, { "Containers": 0 }],
            "Volumes": [{ "UsageData": { "RefCount": 1 } }],
        }))
    }
}

/// A data directory with a store of `alpha`, installed, with its icon and its category, and `beta`, not installed.
struct Fixture {
    _dir: tempfile::TempDir,
    data: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data = dir.path().join("data");
        let store = data.join("app-store");

        fs::create_dir_all(store.join(".git")).expect("created");
        fs::create_dir_all(store.join("config")).expect("created");

        for (app, compose) in [
            (
                "alpha",
                "x-hangar:\n  icon: alpha.svg\nservices:\n  web:\n    image: nginx:alpine\n",
            ),
            ("beta", "services:\n  web:\n    image: nginx:alpine\n"),
        ] {
            fs::create_dir_all(store.join("store").join(app)).expect("created");
            fs::write(store.join("store").join(app).join("compose.yml"), compose).expect("written");
        }

        fs::create_dir_all(data.join("app-installed")).expect("created");
        std::os::unix::fs::symlink(store.join("store/alpha"), data.join("app-installed/alpha"))
            .expect("linked");

        let hash = PasswordHash::new("correct horse").expect("hashed");

        fs::write(
            store.join("config/hangar.yml"),
            format!(
                "categories:\n  - {{ name: Media, color: blue, stacks: [alpha] }}\nusers:\n  - {{ name: Ana, email: \
                 ana@example.com, passwordHash: '{hash}' }}\n"
            ),
        )
        .expect("written");

        Self { _dir: dir, data }
    }

    /// The server on `docker`, served on port 0, and its state, to start; Ana signed in.
    async fn serve(&self, docker: Docker) -> (Server, App) {
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
        let app = App::new(&settings, docker).await;
        let router =
            hangar_server::server(&settings).into_router(hangar_server::router(app.clone()));
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

        let server = Server {
            url,
            cookie: format!("{}={}", cookie.name(), cookie.value()),
        };

        (server, app)
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

    /// `GET path`'s status and JSON.
    async fn get(&self, path: &str) -> (StatusCode, Value) {
        let response = reqwest::Client::new()
            .get(format!("{}{path}", self.url))
            .header(COOKIE, &self.cookie)
            .send()
            .await
            .expect("the server answers");
        let status = response.status();

        (status, response.json().await.expect("JSON"))
    }
}

/// What `future` gives, within [`PATIENCE`].
async fn within<T>(what: &str, future: impl Future<Output = T>) -> T {
    tokio::time::timeout(PATIENCE, future)
        .await
        .unwrap_or_else(|_| panic!("{what} did not come within {PATIENCE:?}"))
}

/// The next item of `stream`, within [`PATIENCE`].
async fn next<S: Stream + Unpin>(what: &str, stream: &mut S) -> S::Item {
    within(what, stream.next())
        .await
        .unwrap_or_else(|| panic!("the stream ended before {what}"))
}

fn docker(docker_host: &str) -> Docker {
    Docker::with_host(docker_host).expect("a client")
}

#[tokio::test]
async fn the_docker_routes_take_a_session() {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    for path in [
        "/api/docker/apps",
        "/api/docker/apps/alpha",
        "/api/docker/stats",
        "/api/docker/overview",
        "/api/docker/changes",
    ] {
        let response = reqwest::get(format!("{}{path}", server.url))
            .await
            .expect("the server answers");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn lists_the_installed_apps_with_their_icon_and_category_and_details_one() -> quoll::Result<()>
{
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;
    let api = server.api();

    let projects = api.docker().projects().await?;
    let detail = api.docker().project("alpha").await?;

    assert_eq!(projects.len(), 1, "beta is not installed: {projects:?}");
    assert_eq!(projects[0].name, "alpha");
    assert_eq!(projects[0].icon.as_deref(), Some("alpha.svg"));
    assert_eq!(
        projects[0]
            .category
            .as_ref()
            .map(|category| category.name.as_str()),
        Some("Media")
    );
    assert_eq!(projects[0].status, ProjectStatus::Running);
    assert_eq!(projects[0].container_ids, [alpha_id()]);
    assert_eq!(detail.summary, projects[0]);
    assert_eq!(detail.services.len(), 1);

    let container = &detail.services[0].containers[0];

    assert_eq!(
        (container.name.as_str(), container.restart_count),
        ("alpha-web-1", Some(1))
    );
    assert_eq!(container.health, Some(ContainerHealth::Healthy));
    assert_eq!(container.ports[0].public_port, 8080);
    Ok(())
}

#[tokio::test]
async fn answers_404_with_its_code_for_an_app_not_installed() {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    let error = server
        .api()
        .docker()
        .project("beta")
        .await
        .expect_err("beta is not installed");
    let problem = error.detail().expect("a problem");

    assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
    assert_eq!(problem.kind(), "/problems/docker.unknown_project");
    assert_eq!(problem.detail(), Some("no app beta is installed"));
    assert_eq!(
        ErrorCode::read(&error),
        Some(ErrorCode::UnknownProject {
            project: "beta".to_owned()
        })
    );
}

#[tokio::test]
async fn reads_the_containers_once_then_again_when_an_event_says_they_changed() -> quoll::Result<()>
{
    let fixture = Fixture::new();
    let (daemon, docker_host, events) = FakeDaemon::serve().await;
    let (server, app) = fixture.serve(docker(&docker_host)).await;
    let api = server.api();

    api.docker().projects().await?;
    // Followed once the containers are kept: its connection reloads them, as nothing was followed before it.
    app.start().await;
    daemon.listed(2).await;

    let mut changes = api.docker().changes().await?;

    daemon.set_state(&alpha_id(), "exited");

    let kept = api.docker().projects().await?;

    assert_eq!(
        kept[0].status,
        ProjectStatus::Running,
        "no event said the containers changed"
    );
    assert_eq!(daemon.lists(), 2, "the containers are kept");

    events
        .send(json!({
            "Type": "container",
            "Action": "die",
            "Actor": { "ID": alpha_id(), "Attributes": { "com.docker.compose.project": "alpha" } },
        }))
        .expect("the daemon follows");

    assert_eq!(
        next("the change", &mut changes).await?,
        DockerChange::Containers
    );
    assert_eq!(
        api.docker().projects().await?[0].status,
        ProjectStatus::Stopped
    );
    assert_eq!(daemon.lists(), 3);
    Ok(())
}

#[tokio::test]
async fn follows_a_log_of_a_container_of_the_app_to_its_end() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    let events: Vec<LogEvent> = server
        .api()
        .docker()
        .logs("alpha", &alpha_id()[..12])
        .await?
        .map(|event| event.expect("an event"))
        .collect()
        .await;

    assert_eq!(
        events,
        [
            LogEvent::Line {
                line: "2026-11-26T10:00:00.000000000Z hello".to_owned()
            },
            LogEvent::Line {
                line: "2026-11-26T10:00:01.000000000Z world".to_owned()
            },
            LogEvent::End,
        ]
    );
    Ok(())
}

#[tokio::test]
async fn answers_404_for_the_log_of_a_container_of_another_app() {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    for container in [beta_id(), "web".to_owned()] {
        let (status, problem) = server
            .get(&format!(
                "/api/docker/apps/alpha/containers/{container}/logs"
            ))
            .await;

        assert_eq!(status, StatusCode::NOT_FOUND, "{container}");
        assert_eq!(
            problem,
            json!({
                "type": "/problems/docker.unknown_container",
                "title": "Not Found",
                "status": 404,
                "detail": format!("the app alpha has no container {container}"),
                "project": "alpha",
                "container": container,
            })
        );
    }
}

#[tokio::test]
async fn streams_the_usage_of_the_running_containers_of_the_installed_apps_alone()
-> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    let mut frames = server.api().docker().stats().await?;
    let frame = next("a frame", &mut frames).await?;
    let alpha = frame.containers[&alpha_id()];

    assert_eq!(
        frame.containers.keys().collect::<Vec<_>>(),
        [&alpha_id()],
        "beta is not installed"
    );
    assert_eq!(alpha.cpu_percent, None, "the first frame has no CPU share");
    assert_eq!(
        (alpha.memory_usage, alpha.memory_limit),
        (Some(2_048), Some(4_096))
    );
    Ok(())
}

#[tokio::test]
async fn streams_the_usage_of_an_app_installed_while_it_is_followed() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;
    let mut frames = server.api().docker().stats().await?;

    assert!(
        !next("a frame", &mut frames)
            .await?
            .containers
            .contains_key(&beta_id())
    );

    let installed = reqwest::Client::new()
        .post(format!("{}/api/store/apps/beta/install", server.url))
        .header(COOKIE, &server.cookie)
        .header(ORIGIN, URL)
        .send()
        .await
        .expect("the server answers");

    assert_eq!(installed.status(), StatusCode::OK);

    // A frame a second: the one after the install has beta.
    within("beta's usage", async {
        while !next("a frame", &mut frames)
            .await
            .expect("a frame")
            .containers
            .contains_key(&beta_id())
        {}
    })
    .await;
    Ok(())
}

#[tokio::test]
async fn gives_the_usage_of_the_whole_host() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    let overview = server.api().docker().overview().await?;

    assert_eq!(
        (overview.version.as_str(), overview.memory),
        ("29.0.1", 16_000)
    );
    assert_eq!(
        (overview.containers.total, overview.containers.running),
        (3, 2)
    );
    assert_eq!(
        (
            overview.images.total,
            overview.images.unused,
            overview.images.size
        ),
        (2, 1, 1_000)
    );
    assert_eq!((overview.volumes.in_use, overview.volumes.unused), (1, 0));
    Ok(())
}

#[tokio::test]
async fn answers_503_with_its_code_when_the_daemon_does_not_answer() {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve(docker("tcp://127.0.0.1:9")).await;

    for path in [
        "/api/docker/apps",
        "/api/docker/apps/alpha",
        "/api/docker/stats",
        "/api/docker/overview",
    ] {
        let (status, problem) = server.get(path).await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{path}");
        assert_eq!(
            problem["detail"], "the Docker daemon could not be read. See the server's log.",
            "{path}"
        );
    }
}

#[tokio::test]
async fn answers_404_for_the_log_of_a_container_of_an_app_not_installed() {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;

    let (status, problem) = server
        .get(&format!(
            "/api/docker/apps/beta/containers/{}/logs",
            beta_id()
        ))
        .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["detail"], "no app beta is installed");
}

#[tokio::test]
async fn tells_the_pages_that_an_app_was_installed() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (_, docker_host, _events) = FakeDaemon::serve().await;
    let (server, _) = fixture.serve(docker(&docker_host)).await;
    let api = server.api();
    let mut changes = api.docker().changes().await?;

    let installed = reqwest::Client::new()
        .post(format!("{}/api/store/apps/beta/install", server.url))
        .header(COOKIE, &server.cookie)
        .header(ORIGIN, URL)
        .send()
        .await
        .expect("the server answers");

    assert_eq!(installed.status(), StatusCode::OK);
    assert_eq!(
        next("the change", &mut changes).await?,
        DockerChange::Containers
    );
    assert_eq!(api.docker().projects().await?.len(), 2);
    Ok(())
}
