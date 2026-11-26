//! `hangar store up` and `down` against a real Docker, through the `docker compose` CLI and the daemon `DOCKER_HOST`
//! names, else Docker's own socket. The test brings a project of its own up and down, and takes it down when it is
//! dropped, even by a failed test.
//!
//! When no daemon answers, or no `docker compose` runs, the test says it is skipped and passes, unless `CI` is set:
//! CI's runners have Docker.

#![cfg(unix)]

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};

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

/// A data directory with one installed app in a category, whose project is taken down when it is dropped.
struct Fixture {
    _dir: TempDir,
    data: PathBuf,
    app: String,
}

impl Fixture {
    /// The fixture, once a daemon answers and `docker compose` runs; none outside CI otherwise.
    fn new() -> Option<Self> {
        if let Err(reason) = Self::docker(&["version"]) {
            return Self::skip(&format!("no Docker daemon answers: {reason}"));
        }

        if let Err(reason) = Self::docker(&["compose", "version"]) {
            return Self::skip(&format!("docker compose does not run: {reason}"));
        }

        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let data = dir.path().to_owned();
        let app = format!("hangar-test-cli-{}", std::process::id());
        let folder = data.join("app-installed").join(&app);
        let config = data.join("app-store/config");

        fs::create_dir_all(&folder).expect("the app's folder can be made");
        fs::create_dir_all(&config).expect("the config folder can be made");
        fs::write(folder.join("compose.yml"), COMPOSE_FILE)
            .expect("the compose file can be written");
        fs::write(data.join(".env.global"), ENV_FILE).expect("the global env can be written");
        fs::write(
            config.join("hangar.yml"),
            format!("categories:\n  - {{ name: Tests, color: blue, stacks: [{app}] }}\n"),
        )
        .expect("hangar.yml can be written");

        Some(Self {
            _dir: dir,
            data,
            app,
        })
    }

    /// Runs `docker` with `args`, and returns its stdout, or why it failed.
    fn docker(args: &[&str]) -> Result<String, String> {
        let output = Command::new("docker")
            .args(args)
            .output()
            .map_err(|error| error.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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

    /// `hangar` with `args`, on the fixture's data directory.
    fn hangar(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_hangar"))
            .args(args)
            .current_dir(&self.data)
            .env("HANGAR_DATA_DIR", &self.data)
            .output()
            .expect("the binary was built for this test")
    }

    /// The ids of the project's containers, running or not.
    fn containers(&self) -> Vec<String> {
        let label = format!("label=com.docker.compose.project={}", self.app);
        let ids = Self::docker(&["ps", "--all", "--quiet", "--filter", &label])
            .expect("the daemon lists its containers");

        ids.lines().map(str::to_owned).collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // By the project's labels, so that it needs no file.
        if let Err(reason) = Self::docker(&["compose", "-p", &self.app, "down", "--remove-orphans"])
        {
            eprintln!("could not take {} down: {reason}", self.app);
        }
    }
}

#[test]
fn brings_every_listed_app_up_then_takes_its_category_down() {
    let Some(fixture) = Fixture::new() else {
        return;
    };

    let up = fixture.hangar(&["store", "up"]);

    assert!(
        up.status.success(),
        "{}",
        String::from_utf8_lossy(&up.stderr)
    );
    assert_eq!(fixture.containers().len(), 1, "the app's container runs");

    let down = fixture.hangar(&["store", "Tests", "down"]);

    assert!(
        down.status.success(),
        "{}",
        String::from_utf8_lossy(&down.stderr)
    );
    assert!(fixture.containers().is_empty(), "no container is left");
}
