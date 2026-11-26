//! Compose against a real Docker, through the `docker compose` CLI and the daemon `DOCKER_HOST` names, else Docker's
//! own socket. The test brings a project of its own up and down, and takes it down when it is dropped, even by a
//! failed test.
//!
//! When no daemon answers, or no `docker compose` runs, the test says it is skipped and passes, unless `CI` is set:
//! CI's runners have Docker.

#![cfg(unix)]

use std::path::PathBuf;

use futures::StreamExt;
use hangar_core::{
    BatchEvent, Command, CommandRunner, Compose, ComposeCommand, ComposeContainer, ComposeError,
    Config, ContainerState, DataDir, Docker, OnFailure, Output, Runtime, UpOptions,
};
use tempfile::TempDir;

/// The app's compose file. It reads how long it sleeps from `.env.global`, so that it runs only with the file every
/// call passes; killed at once on `down`, as `sleep` would ignore SIGTERM for the whole grace period.
const COMPOSE_FILE: &str = r#"
services:
  sleeper:
    image: busybox:1.37
    command: ["sleep", "${HANGAR_TEST_SLEEP}"]
    stop_signal: SIGKILL
"#;

/// The global environment: the container lives two minutes at most, so that one a failed test leaves behind does
/// not run on.
const ENV_FILE: &str = "HANGAR_TEST_SLEEP=120\n";

/// A data directory with one installed app, whose project is taken down when it is dropped.
struct Fixture {
    _dir: TempDir,
    data_dir: DataDir,
    app: String,
    docker: Docker,
}

impl Fixture {
    /// The fixture, once a daemon answers and `docker compose` runs; none outside CI otherwise.
    async fn new() -> Option<Self> {
        let docker = Docker::connect().expect("DOCKER_HOST names a daemon Hangar can reach");

        if let Err(error) = docker.containers().await {
            return Self::skip(&format!("no Docker daemon answers: {error}"));
        }

        let version = Command::new("docker").args(["compose", "version"]);

        if let Err(error) = Runtime::new().capture(&version).await {
            return Self::skip(&format!("docker compose does not run: {error}"));
        }

        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let data_dir = DataDir::new(dir.path()).expect("the temporary directory resolves");
        let app = format!("hangar-test-compose-{}", std::process::id());
        let folder = data_dir.installed().join(&app);

        std::fs::create_dir_all(&folder).expect("the app's folder can be made");
        std::fs::write(folder.join("compose.yml"), COMPOSE_FILE)
            .expect("the compose file can be written");
        std::fs::write(data_dir.env_file(), ENV_FILE).expect("the global env can be written");

        Some(Self {
            _dir: dir,
            data_dir,
            app,
            docker,
        })
    }

    /// Says why the test is skipped, unless in CI, which must run it.
    fn skip(reason: &str) -> Option<Self> {
        assert!(
            std::env::var_os("CI").is_none(),
            "CI needs Docker and docker compose: {reason}"
        );
        eprintln!("skipped: {reason}");

        None
    }

    /// A file beside the app's `compose.yml`, holding `source`.
    fn pending(&self, name: &str, source: &str) -> PathBuf {
        let file = self.data_dir.installed().join(&self.app).join(name);

        std::fs::write(&file, source).expect("the file can be written");

        file
    }

    /// The containers of the app's project.
    async fn containers(&self) -> Vec<ComposeContainer> {
        let containers = self
            .docker
            .containers()
            .await
            .expect("the daemon lists its containers");

        containers
            .as_slice()
            .iter()
            .filter(|container| container.project == self.app)
            .cloned()
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Blocking, as a drop cannot await: by the project's labels, so that it needs no file.
        let down = std::process::Command::new("docker")
            .args(["compose", "-p", &self.app, "down", "--remove-orphans"])
            .output();

        match down {
            Ok(output) if output.status.success() => {}
            Ok(output) => eprintln!(
                "could not take {} down: {}",
                self.app,
                String::from_utf8_lossy(&output.stderr)
            ),
            Err(error) => eprintln!("could not take {} down: {error}", self.app),
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn checks_a_file_then_brings_a_project_up_in_a_batch_and_down() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    let compose = Compose::new(fixture.data_dir.clone(), Runtime::new());
    let app = fixture.app.as_str();

    let valid = fixture.pending(".valid.pending.yml", COMPOSE_FILE);
    let invalid = fixture.pending(".invalid.pending.yml", "services: 3\n");

    compose
        .validate(&valid)
        .await
        .expect("compose accepts the app's file");

    let error = compose
        .validate(&invalid)
        .await
        .expect_err("compose rejects a file whose services are no mapping");

    assert!(matches!(error, ComposeError::Invalid { .. }), "{error:?}");

    let up = ComposeCommand::Up(UpOptions::default());
    let batch = compose
        .batch(up, &[app], &Config::default(), OnFailure::CarryOn)
        .await
        .expect("the app is installed");
    let report = batch.finished().await;

    assert_eq!(report.failures(), 0, "{report:?}");

    let containers = fixture.containers().await;

    assert_eq!(containers.len(), 1, "{containers:?}");
    assert_eq!(containers[0].service, "sleeper");
    assert_eq!(containers[0].state, ContainerState::Running);

    // Listened to once over, the batch still has its output, from its start.
    let events: Vec<BatchEvent> = batch.output().collect().await;

    assert!(
        matches!(events.first(), Some(BatchEvent::Started { app: started }) if started.as_ref() == app)
    );
    assert!(
        matches!(events.last(), Some(BatchEvent::Finished(outcome)) if outcome.status.is_success())
    );

    compose
        .run(app, ComposeCommand::Down, Output::Inherit)
        .await
        .expect("compose takes the project down");

    assert!(fixture.containers().await.is_empty());
}
