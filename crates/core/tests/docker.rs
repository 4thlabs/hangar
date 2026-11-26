//! The Docker client against a real daemon: the one `DOCKER_HOST` names, else Docker's own socket. Each test makes
//! the containers of a compose project of its own, with the labels compose would put, and removes them after.
//!
//! When no daemon answers, each test says it is skipped and passes, unless `CI` is set: CI's runners have Docker.

use std::collections::HashMap;
use std::fmt;
use std::time::Duration;

use futures::{Stream, StreamExt};
use hangar_core::{ContainerState, Docker, DockerChange, DockerError, ProjectStatus};
use quoll::{JsonLines, Text, client};
use serde::{Deserialize, Serialize};

/// The image of the containers: small, with `sh`, `seq` and `sed`.
const IMAGE: &str = "busybox";

/// Its tag.
const TAG: &str = "1.37";

/// How long a container lives at most, in seconds, so that one a failed test leaves behind does not run on.
const LIFETIME: u32 = 120;

/// How long a test waits for what it checks before it fails.
const PATIENCE: Duration = Duration::from_secs(60);

quoll::api! {
    /// The calls the tests make their containers with.
    #[server(none)]
    #[error(Message)]
    api Fixtures = "/v1.44";

    group Daemon {
        GET    "/_ping" => ping() -> Text;
        GET    "/images/{name}/json" => image(name: &str) -> serde_json::Value;
        POST   "/images/create?fromImage={image}&tag={tag}" => pull(image: &str, tag: &str) -> JsonLines<PullProgress>;
        POST   "/containers/create" => create(container: &NewContainer) -> CreatedContainer;
        POST   "/containers/{id}/start" => start(id: &str);
        POST   "/containers/{id}/kill?signal={signal}" => kill(id: &str, signal: &str);
        DELETE "/containers/{id}?force={force}" => remove(id: &str, force: bool);
    }
}

/// The body of Docker's errors.
#[derive(Debug, Clone, Deserialize)]
struct Message {
    message: String,
}

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// A line of a pull's progress: a failure is a line with an `error`.
#[derive(Debug, Clone, Deserialize)]
struct PullProgress {
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
struct NewContainer {
    image: String,
    cmd: Vec<String>,
    labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CreatedContainer {
    id: String,
}

/// A compose project of a test: its containers, removed when it is dropped, even by a failed test.
struct Project {
    name: String,
    fixtures: FixturesClient,
    containers: Vec<String>,
}

impl Project {
    /// The project `test` makes, once the daemon answers and has the image; none when no daemon answers outside CI.
    async fn new(test: &str) -> Option<Self> {
        let fixtures = Self::fixtures();

        if let Err(error) = fixtures.daemon().ping().await {
            assert!(
                std::env::var_os("CI").is_none(),
                "CI needs a Docker daemon, and none answers: {error}"
            );
            eprintln!("skipped: no Docker daemon answers: {error}");

            return None;
        }

        Self::pull(&fixtures).await;

        Some(Self {
            name: format!("hangar-test-{test}-{}", std::process::id()),
            fixtures,
            containers: Vec::new(),
        })
    }

    /// A client of the daemon `DOCKER_HOST` names, `tcp://` or `unix://`, else of Docker's own socket.
    fn fixtures() -> FixturesClient {
        let docker_host = std::env::var("DOCKER_HOST").unwrap_or_default();
        let builder = client::builder();
        let built = match docker_host.strip_prefix("tcp://") {
            Some(address) => builder.build::<Fixtures>(&format!("http://{address}")),
            None => {
                let socket = docker_host
                    .strip_prefix("unix://")
                    .unwrap_or("/var/run/docker.sock")
                    .to_owned();

                builder
                    .http(move |http| http.unix_socket(socket))
                    .build::<Fixtures>("http://localhost")
            }
        };

        built.expect("a client of the daemon")
    }

    /// Pulls the image, unless the daemon has it.
    async fn pull(fixtures: &FixturesClient) {
        if fixtures
            .daemon()
            .image(&format!("{IMAGE}:{TAG}"))
            .await
            .is_ok()
        {
            return;
        }

        let mut progress = fixtures.daemon().pull(IMAGE, TAG).await.expect("a pull");

        while let Some(line) = progress.next().await {
            let line = line.expect("a line of the pull's progress");

            assert_eq!(line.error, None, "the pull of {IMAGE}:{TAG} failed");
        }
    }

    /// Makes a replica of `service` running `script`, with these compose labels on top, and starts it unless it is
    /// to stay created.
    async fn container(
        &mut self,
        service: &str,
        script: &str,
        start: Start,
        labels: &[(&str, &str)],
    ) -> String {
        let mut all = HashMap::from([
            ("com.docker.compose.project".to_owned(), self.name.clone()),
            ("com.docker.compose.service".to_owned(), service.to_owned()),
            (
                "com.docker.compose.container-number".to_owned(),
                "1".to_owned(),
            ),
        ]);

        all.extend(
            labels
                .iter()
                .map(|(name, value)| ((*name).to_owned(), (*value).to_owned())),
        );

        let container = NewContainer {
            image: format!("{IMAGE}:{TAG}"),
            cmd: vec!["sh".to_owned(), "-c".to_owned(), script.to_owned()],
            labels: all,
        };
        let id = self
            .fixtures
            .daemon()
            .create(&container)
            .await
            .expect("a container")
            .id;

        self.containers.push(id.clone());

        if start == Start::Now {
            self.fixtures
                .daemon()
                .start(&id)
                .await
                .expect("a started container");
        }

        id
    }

    /// A replica of `service` that runs until it is removed.
    async fn running(&mut self, service: &str) -> String {
        self.container(service, &format!("sleep {LIFETIME}"), Start::Now, &[])
            .await
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let containers = std::mem::take(&mut self.containers);

        // Dropped within the test's runtime, which cannot block on its own: the removal runs on a runtime of its own,
        // with a client of its own, as the connections of the test's client are served by the test's runtime.
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a runtime");
            let fixtures = Self::fixtures();

            runtime.block_on(async {
                for id in containers {
                    if let Err(error) = fixtures.daemon().remove(&id, true).await {
                        eprintln!("could not remove the container {id}: {error}");
                    }
                }
            });
        })
        .join()
        .expect("the containers removed");
    }
}

/// Whether a container starts once made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Start {
    Now,
    Never,
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

/// The text of a log line, after the time the daemon puts first.
fn text(line: &str) -> &str {
    line.split_once(' ').map_or(line, |(_, text)| text)
}

fn docker() -> Docker {
    Docker::connect().expect("a client of the daemon")
}

#[tokio::test]
async fn groups_the_containers_by_compose_project_and_service() {
    let Some(mut project) = Project::new("compose").await else {
        return;
    };
    let web = project.running("web").await;
    let db = project.container("db", "true", Start::Never, &[]).await;

    project
        .container(
            "web",
            &format!("sleep {LIFETIME}"),
            Start::Now,
            &[("com.docker.compose.oneoff", "True")],
        )
        .await;

    let containers = docker().containers().await.expect("the containers");
    let summaries = containers.summaries([project.name.as_str()]);
    let detail = containers
        .detail(&project.name, [project.name.as_str()])
        .expect("the project");
    let services: Vec<(&str, Vec<(&str, ContainerState)>)> = detail
        .services
        .iter()
        .map(|service| {
            let containers = service
                .containers
                .iter()
                .map(|container| (container.id.as_str(), container.state))
                .collect();

            (service.name.as_str(), containers)
        })
        .collect();

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].status, ProjectStatus::Partial);
    assert_eq!(summaries[0].service_count, 2);
    assert_eq!(summaries[0].running_count, 1);
    assert_eq!(
        summaries[0].container_ids.len(),
        2,
        "the container of a compose run is left out"
    );
    assert_eq!(
        services,
        [
            ("db", vec![(db.as_str(), ContainerState::Created)]),
            ("web", vec![(web.as_str(), ContainerState::Running)]),
        ]
    );
}

#[tokio::test]
async fn finds_a_container_only_within_its_project_and_by_id() {
    let Some(mut project) = Project::new("lookup").await else {
        return;
    };
    let web = project.running("web").await;
    let docker = docker();

    let found = docker
        .project_container(&project.name, &web[..12])
        .await
        .expect("the container");
    let uppercase = docker
        .project_container(&project.name, &web[..12].to_ascii_uppercase())
        .await
        .expect("the container, by its id in uppercase");
    let elsewhere = docker.project_container("another-project", &web).await;
    let by_name = docker.project_container(&project.name, "web").await;

    assert_eq!(found.id, web);
    assert_eq!(found.service, "web");
    assert_eq!(uppercase.id, web);
    assert!(
        matches!(elsewhere, Err(DockerError::NotFound { .. })),
        "{elsewhere:?}"
    );
    assert!(
        matches!(by_name, Err(DockerError::NotFound { .. })),
        "{by_name:?}"
    );
}

#[tokio::test]
async fn follows_a_log_from_its_last_200_lines() {
    let Some(mut project) = Project::new("logs").await else {
        return;
    };
    // Writes 301 lines, then one more on each SIGUSR1, which interrupts the `wait`.
    let script = format!(
        "trap 'echo late' USR1; seq 1 300 | sed 's/^/line /'; echo ready; \
         for i in $(seq 1 {LIFETIME}); do sleep 1 & wait $!; done"
    );
    let web = project.container("web", &script, Start::Now, &[]).await;
    let docker = docker();

    // Every line written, before the log that is checked opens.
    let mut first = Box::pin(docker.logs(&project.name, &web).await.expect("the log"));

    while text(&next("the line `ready`", &mut first).await.expect("a line")) != "ready" {}

    drop(first);

    let mut log = Box::pin(docker.logs(&project.name, &web).await.expect("the log"));
    let mut tail = Vec::new();

    for _ in 0..200 {
        tail.push(next("the tail", &mut log).await.expect("a line"));
    }

    project
        .fixtures
        .daemon()
        .kill(&web, "USR1")
        .await
        .expect("a signal");

    let late = next("the line written after the log opened", &mut log)
        .await
        .expect("a line");

    assert_eq!(text(&tail[0]), "line 102");
    assert_eq!(text(&tail[198]), "line 300");
    assert_eq!(text(&tail[199]), "ready");
    assert!(
        tail[0].starts_with("20"),
        "a line starts with its time: {}",
        tail[0]
    );
    assert_eq!(text(&late), "late");
}

#[tokio::test]
async fn measures_the_cpu_share_from_the_second_frame() {
    let Some(mut project) = Project::new("stats").await else {
        return;
    };
    let web = project.running("web").await;
    let mut stats = Box::pin(docker().stats().await.expect("the stats"));

    let first = next("the first frame", &mut stats).await.expect("a frame");
    let second = next("the second frame", &mut stats).await.expect("a frame");

    assert_eq!(first[&web].cpu_percent, None);
    assert!(first[&web].memory_usage.is_some(), "{:?}", first[&web]);
    assert!(second[&web].cpu_percent.is_some(), "{:?}", second[&web]);
}

#[tokio::test]
async fn reports_every_change_then_those_of_a_compose_container() {
    let Some(mut project) = Project::new("events").await else {
        return;
    };
    let mut events = Box::pin(docker().events());
    let mut connected = Vec::new();

    for _ in DockerChange::ALL {
        connected.push(
            next("the changes of the connection", &mut events)
                .await
                .expect("a change"),
        );
    }

    project.running("web").await;

    within("a change of the containers", async {
        while next("a change", &mut events).await.expect("a change") != DockerChange::Containers {}
    })
    .await;

    assert_eq!(connected, DockerChange::ALL);
}

#[tokio::test]
async fn gives_the_digests_of_the_image_a_container_runs_and_the_usage_of_the_host() {
    let Some(mut project) = Project::new("images").await else {
        return;
    };

    project.running("web").await;

    let docker = docker();
    let containers = docker.containers().await.expect("the containers");
    let digests = docker.image_digests().await.expect("the digests");
    let overview = docker.overview().await.expect("the overview");
    let running = containers.running_images([project.name.as_str()], &digests);

    assert_eq!(running.len(), 1);
    assert_eq!(running[0].image, format!("{IMAGE}:{TAG}"));
    assert!(
        running[0]
            .digests
            .iter()
            .any(|digest| digest.starts_with(&format!("{IMAGE}@sha256:"))),
        "a pulled image has its registry's digest: {running:?}"
    );
    assert!(
        !overview.version.is_empty() && overview.memory > 0,
        "{overview:?}"
    );
    assert!(overview.containers.running >= 1, "{overview:?}");
    assert!(
        overview.images.total >= 1 && overview.images.size > 0,
        "{overview:?}"
    );
}
