//! The jobs' routes and the image check run as the server starts its jobs, served on port 0 and called with a session
//! by the client of the contract and by reqwest, on a fake daemon served on port 0 too, which answers for the
//! registries.

#![cfg(unix)]

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use axum::Json;
use axum::extract::Path;
use axum::routing::get;
use cookie::Cookie;
use futures::{Stream, StreamExt};
use hangar_api::{
    Api, ApiClient, Docker as _, DockerChange, ErrorCode, Job, JobQueue, Jobs as _,
    NotificationEvent, NotificationMessage, Notifications as _, Session,
};
use hangar_core::{Docker, PasswordHash};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{COOKIE, ORIGIN, SET_COOKIE};
use serde_json::{Value, json};

const URL: &str = "https://hangar.example.com";

/// How long a test waits for what it checks before it fails.
const PATIENCE: Duration = Duration::from_secs(30);

/// The installed apps, the image each runs, the digest of the image it runs, and the digest its registry serves:
/// `alpha` runs an image the registry has moved past, `gamma` the one it serves.
const APPS: [(&str, &str, &str, &str); 2] = [
    ("alpha", "nginx:alpine", "sha256:old", "sha256:new"),
    ("gamma", "redis:7", "sha256:redis", "sha256:redis"),
];

/// A daemon on port 0 that runs a container of each of [`APPS`], answers for their registries, and sends no event;
/// the URL of `DOCKER_HOST`.
async fn daemon() -> String {
    let router = axum::Router::new()
        .route("/v1.44/containers/json", get(containers))
        .route(
            "/v1.44/containers/{id}/json",
            get(|| async { Json(json!({})) }),
        )
        .route("/v1.44/images/json", get(images))
        .route("/v1.44/distribution/{reference}/json", get(distribution))
        .route("/v1.44/events", get(futures::future::pending::<()>));
    let url = quoll::test::spawn(router).await;

    url.replace("http://", "tcp://")
}

async fn containers() -> Json<Vec<Value>> {
    Json(
        APPS.iter()
            .enumerate()
            .map(|(index, (app, image, _, _))| {
                json!({
                    "Id": index.to_string().repeat(64),
                    "Names": [format!("/{app}-web-1")],
                    "Image": image,
                    "ImageID": format!("sha256:{app}"),
                    "State": "running",
                    "Status": "Up 2 hours",
                    "Labels": {
                        "com.docker.compose.project": app,
                        "com.docker.compose.service": "web",
                        "com.docker.compose.container-number": "1",
                    },
                })
            })
            .collect(),
    )
}

async fn images() -> Json<Vec<Value>> {
    Json(
        APPS.iter()
            .map(|(app, image, runs, _)| {
                let name = image.split(':').next().unwrap_or_default();

                json!({ "Id": format!("sha256:{app}"), "RepoDigests": [format!("{name}@{runs}")] })
            })
            .collect(),
    )
}

async fn distribution(Path(reference): Path<String>) -> Json<Value> {
    let served = APPS
        .iter()
        .find(|(_, image, _, _)| *image == reference)
        .map_or("sha256:unknown", |(_, _, _, served)| *served);

    Json(json!({ "Descriptor": { "digest": served } }))
}

/// A data directory where [`APPS`] are installed.
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
        fs::create_dir_all(data.join("app-installed")).expect("created");

        for (app, image, _, _) in APPS {
            let folder = store.join("store").join(app);

            fs::create_dir_all(&folder).expect("created");
            fs::write(
                folder.join("compose.yml"),
                format!("services:\n  web:\n    image: {image}\n"),
            )
            .expect("written");
            std::os::unix::fs::symlink(&folder, data.join("app-installed").join(app))
                .expect("linked");
        }

        let hash = PasswordHash::new("correct horse").expect("hashed");

        fs::write(
            store.join("config/hangar.yml"),
            format!(
                "categories:\n  - {{ name: Apps, color: blue, stacks: [alpha, gamma] }}\nregistryThrottling: 0\n\
                 users:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n"
            ),
        )
        .expect("written");

        Self { _dir: dir, data }
    }

    /// The server on the daemon of `docker_host`, served on port 0, and its state; Ana signed in.
    async fn serve(&self, docker_host: &str) -> (Server, App) {
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
        let docker = Docker::with_host(docker_host).expect("a client");
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

#[tokio::test]
async fn the_jobs_routes_take_a_session() {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve(&daemon().await).await;
    let client = reqwest::Client::new();

    for request in [
        client.get(format!("{}/api/jobs", server.url)),
        client.post(format!("{}/api/jobs/1/run", server.url)),
        client.post(format!("{}/api/jobs/1/cancel", server.url)),
    ] {
        let response = request
            .header(ORIGIN, URL)
            .send()
            .await
            .expect("the server answers");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn checks_the_images_as_its_jobs_start_and_tells_the_pages_which_apps_have_an_update()
-> quoll::Result<()> {
    let fixture = Fixture::new();
    let (server, app) = fixture.serve(&daemon().await).await;
    let api = server.api();

    assert!(api.jobs().list().await?.is_empty(), "no job runs before");
    assert!(
        api.docker()
            .projects()
            .await?
            .iter()
            .all(|project| !project.update_available),
        "no app has an update before a check"
    );

    let mut changes = api.docker().changes().await?;
    let mut notifications = api.notifications().events(None, None).await?;

    app.start_jobs();

    let runs = api.jobs().list().await?;

    assert_eq!(runs.len(), 1);
    assert_eq!(
        (runs[0].id, runs[0].job, runs[0].queue),
        (1, Job::ImageCheck, JobQueue::Default)
    );
    assert_eq!(
        next("the change", &mut changes).await?,
        DockerChange::Containers
    );

    let updates: Vec<(String, bool)> = api
        .docker()
        .projects()
        .await?
        .into_iter()
        .map(|project| (project.name, project.update_available))
        .collect();

    assert_eq!(
        updates,
        [("alpha".to_owned(), true), ("gamma".to_owned(), false)]
    );
    assert!(
        api.docker()
            .project("alpha")
            .await?
            .summary
            .update_available
    );

    let NotificationEvent::Opened { .. } = next("the epoch", &mut notifications).await? else {
        panic!("the stream opens with the epoch");
    };
    let NotificationEvent::Filed { notification } =
        next("the notification", &mut notifications).await?
    else {
        panic!("a notification is filed");
    };

    assert_eq!(
        notification.message,
        NotificationMessage::UpdatesAvailable { count: 1 }
    );
    Ok(())
}

#[tokio::test]
async fn answers_a_404_for_a_run_it_does_not_keep() {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve(&daemon().await).await;
    let api = server.api();

    for error in [
        api.jobs().run(7).await.expect_err("no run 7"),
        api.jobs().cancel(7).await.expect_err("no run 7"),
    ] {
        assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
        assert_eq!(
            ErrorCode::read(&error),
            Some(ErrorCode::UnknownJobRun { run: 7 })
        );
    }
}
