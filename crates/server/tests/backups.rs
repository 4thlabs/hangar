//! The backups' routes and their job, served on port 0 and called with a session by the client of the contract and by
//! reqwest: a backup stops and starts its app's services with a fake `docker` first in the runtime's `PATH`.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;

use cookie::Cookie;
use futures::{Stream, StreamExt};
use hangar_api::{
    Api, ApiClient, BackupPlan, Backups as _, Config as _, ConfigSource, ErrorCode, ErrorDetail,
    Job, JobQueue, NotificationEvent, NotificationMessage, Notifications as _,
};
use hangar_core::{Docker, PasswordHash, Runtime};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{
    ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, COOKIE,
    ORIGIN, SET_COOKIE,
};
use serde_json::json;

const URL: &str = "https://hangar.example.com";

/// How long a test waits for what it checks before it fails.
const PATIENCE: Duration = Duration::from_secs(30);

/// An archive of `alpha` a test writes, and its bytes.
const ARCHIVE: &str = "2026-10-18T03-30-00-000Z";
const ARCHIVE_BYTES: &[u8] = b"PK\x05\x06 an archive, as far as the routes care";

/// The fake `docker`: it logs its arguments, one call per line; answers `ps` with `web` running; and holds its stop
/// until the file `HANGAR_TEST_RELEASE` exists, its child's wait and not the test's.
const FAKE_DOCKER: &str = r#"#!/bin/sh
echo "$*" | sed 's/.* -f [^ ]* //' >> "$HANGAR_TEST_LOG"
case " $* " in
  *" ps "*) echo '{"ID":"aaaaaaaaaaaa1111","Service":"web","State":"running"}' ;;
  *" stop "*) while [ ! -e "$HANGAR_TEST_RELEASE" ]; do sleep 0.01; done ;;
esac
"#;

/// The users of `hangar.yml`, Ana alone.
fn users() -> String {
    let hash = PasswordHash::new("correct horse").expect("hashed");

    format!("users:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n")
}

/// A data directory where `alpha` is installed, with a file in its data folder, which `hangar.yml` backs up, its
/// services stopped, as it does `beta`, whose folder is not there; the fake `docker`.
struct Fixture {
    dir: tempfile::TempDir,
    data: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data = dir.path().join("data");
        let store = data.join("app-store");
        let installed = data.join("app-installed/alpha");
        let bin = dir.path().join("bin");

        for folder in [
            store.join(".git"),
            store.join("config"),
            installed.clone(),
            data.join("app-data/alpha"),
            bin.clone(),
        ] {
            fs::create_dir_all(folder).expect("created");
        }

        fs::write(data.join("app-data/alpha/app.ini"), "kept").expect("written");
        fs::write(installed.join("compose.yml"), "services: {}\n").expect("written");
        fs::write(bin.join("docker"), FAKE_DOCKER).expect("written");
        fs::set_permissions(bin.join("docker"), fs::Permissions::from_mode(0o755))
            .expect("made executable");

        let fixture = Self { dir, data };

        fixture.write_config(
            "backups:\n  - { app: alpha, schedule: '0 3 * * *', keep: 3, stop: true }\n  - { app: beta }\n",
        );
        fixture
    }

    /// The `hangar.yml` of `backups`, and Ana.
    fn config(backups: &str) -> String {
        format!("categories: []\n{backups}{}", users())
    }

    fn write_config(&self, backups: &str) {
        fs::write(
            self.data.join("app-store/config/hangar.yml"),
            Self::config(backups),
        )
        .expect("written");
    }

    /// Writes the archive [`ARCHIVE`] of `alpha`.
    fn write_archive(&self) {
        let folder = self.data.join("app-backups/alpha");

        fs::create_dir_all(&folder).expect("created");
        fs::write(folder.join(format!("{ARCHIVE}.zip")), ARCHIVE_BYTES).expect("written");
    }

    /// Lets the fake `docker` stop the services.
    fn release(&self) {
        fs::write(self.dir.path().join("release"), "").expect("written");
    }

    /// The compose commands the fake `docker` ran, after the app's compose file.
    fn docker_calls(&self) -> Vec<String> {
        fs::read_to_string(self.dir.path().join("docker.log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// The server, served on port 0, and its state; Ana signed in.
    async fn serve(&self) -> (Server, App) {
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
        let runtime = Runtime::new().envs([
            (
                "PATH",
                format!("{}:{path}", self.dir.path().join("bin").display()),
            ),
            (
                "HANGAR_TEST_LOG",
                self.dir.path().join("docker.log").display().to_string(),
            ),
            (
                "HANGAR_TEST_RELEASE",
                self.dir.path().join("release").display().to_string(),
            ),
        ]);
        // No daemon: the backups read none.
        let docker = Docker::with_host("tcp://127.0.0.1:9").expect("a client");
        let app = App::with_runtime(&settings, runtime, docker).await;
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

    /// A `GET` of `path` with the session, as a browser that accepts gzip sends it.
    async fn get(&self, path: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(format!("{}{path}", self.url))
            .header(COOKIE, &self.cookie)
            .header(ACCEPT_ENCODING, "gzip")
            .send()
            .await
            .expect("the server answers")
    }
}

/// The next notification filed on `events`, within [`PATIENCE`].
async fn next_filed<S>(events: &mut S) -> NotificationMessage
where
    S: Stream<Item = quoll::Result<NotificationEvent>> + Unpin,
{
    loop {
        let event = tokio::time::timeout(PATIENCE, events.next())
            .await
            .expect("a notification comes")
            .expect("the stream goes on")
            .expect("an event");

        if let NotificationEvent::Filed { notification } = event {
            return notification.message;
        }
    }
}

fn backup(app: &str) -> Job {
    Job::Backup {
        app: app.to_owned(),
    }
}

#[tokio::test]
async fn the_backups_routes_take_a_session() {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve().await;
    let client = reqwest::Client::new();
    let archive = format!("{}/api/backups/alpha/{ARCHIVE}", server.url);

    for request in [
        client.get(format!("{}/api/backups/alpha", server.url)),
        client.post(format!("{}/api/backups/alpha", server.url)),
        client.get(&archive),
        client.delete(&archive),
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
async fn backs_an_app_up_when_asked_one_run_at_a_time_and_lists_its_new_archive()
-> quoll::Result<()> {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve().await;
    let api = server.api();
    let mut notifications = api.notifications().events(None, None).await?;

    let before = api.backups().status("alpha").await?;

    assert_eq!(
        before.plan,
        Some(BackupPlan {
            schedule: Some("0 3 * * *".to_owned()),
            keep: 3,
            stop: true,
        })
    );
    assert!(before.archives.is_empty() && before.run.is_none());

    let asked = api.backups().back_up("alpha").await?;

    assert_eq!(
        (asked.job.clone(), asked.queue),
        (backup("alpha"), JobQueue::Backups)
    );
    assert_eq!(
        api.backups().status("alpha").await?.run.map(|run| run.id),
        Some(asked.id)
    );

    // The fake `docker` holds its stop: the run waits or runs, and no second is asked for.
    let refused = api
        .backups()
        .back_up("alpha")
        .await
        .expect_err("one waits or runs");

    assert_eq!(refused.status(), Some(StatusCode::CONFLICT));
    assert_eq!(
        ErrorCode::read(&refused),
        Some(ErrorCode::BackupQueued {
            app: "alpha".to_owned()
        })
    );

    // Beta's waits its turn after alpha's, in the queue of the backups: its failure says alpha's has ended.
    api.backups().back_up("beta").await?;
    fixture.release();

    assert_eq!(
        next_filed(&mut notifications).await,
        NotificationMessage::BackupFailed {
            app: "beta".to_owned(),
            error: ErrorDetail::from(ErrorCode::NoDataFolder {
                app: "beta".to_owned(),
                folder: "beta".to_owned(),
            }),
        }
    );

    let after = api.backups().status("alpha").await?;

    assert_eq!(after.archives.len(), 1);
    assert!(after.run.is_none());
    assert_eq!(
        fixture.docker_calls(),
        ["ps --status running --format json", "stop web", "start web"]
    );
    Ok(())
}

#[tokio::test]
async fn refuses_to_back_up_an_app_hangar_yml_does_not_declare() {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve().await;
    let error = server
        .api()
        .backups()
        .back_up("gamma")
        .await
        .expect_err("not declared");

    assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
    assert_eq!(
        ErrorCode::read(&error),
        Some(ErrorCode::BackupNotDeclared {
            app: "gamma".to_owned()
        })
    );
}

#[tokio::test]
async fn answers_no_backup_for_a_name_no_app_has() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve().await;
    let status = server.api().backups().status("llama.cpp").await?;

    assert!(status.plan.is_none() && status.archives.is_empty() && status.run.is_none());
    Ok(())
}

#[tokio::test]
async fn sends_an_archive_whole_with_its_length_and_its_name_uncompressed() {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve().await;

    fixture.write_archive();

    let response = server.get(&format!("/api/backups/alpha/{ARCHIVE}")).await;
    let header = |name| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header(CONTENT_TYPE).as_deref(), Some("application/zip"));
    assert_eq!(
        header(CONTENT_LENGTH),
        Some(ARCHIVE_BYTES.len().to_string())
    );
    assert_eq!(
        header(CONTENT_DISPOSITION),
        Some(format!("attachment; filename=\"alpha-{ARCHIVE}.zip\""))
    );
    assert_eq!(header(CACHE_CONTROL).as_deref(), Some("private, no-store"));
    assert_eq!(
        response.bytes().await.expect("the body").as_ref(),
        ARCHIVE_BYTES
    );
}

#[tokio::test]
async fn removes_an_archive_and_answers_a_404_for_one_not_there() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (server, _) = fixture.serve().await;
    let api = server.api();

    fixture.write_archive();

    let listed = api.backups().status("alpha").await?.archives;

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, ARCHIVE);
    assert_eq!(listed[0].size, ARCHIVE_BYTES.len() as u64);
    assert_eq!(listed[0].created_at, "2026-10-18T03:30:00.000Z");

    api.backups().remove("alpha", ARCHIVE).await?;

    assert!(api.backups().status("alpha").await?.archives.is_empty());

    for archive in [ARCHIVE, "latest", "2026-10-18"] {
        let error = api
            .backups()
            .remove("alpha", archive)
            .await
            .expect_err("not there");

        assert_eq!(error.status(), Some(StatusCode::NOT_FOUND), "{archive}");
        assert_eq!(
            ErrorCode::read(&error),
            Some(ErrorCode::UnknownArchive {
                app: "alpha".to_owned(),
                archive: archive.to_owned(),
            })
        );
        assert_eq!(
            server
                .get(&format!("/api/backups/alpha/{archive}"))
                .await
                .status(),
            StatusCode::NOT_FOUND,
            "{archive}"
        );
    }

    Ok(())
}

#[tokio::test]
async fn schedules_a_backup_hangar_yml_gives_a_cron_once_it_is_saved() -> quoll::Result<()> {
    let fixture = Fixture::new();
    let (server, app) = fixture.serve().await;
    let api = server.api();
    let mut notifications = api.notifications().events(None, None).await?;

    app.start_jobs();
    api.config()
        .save(&ConfigSource {
            source: Fixture::config("backups:\n  - { app: beta, schedule: '* * * * * *' }\n"),
        })
        .await?;

    // Its cron fires within the second: the backup of beta, whose folder is not there, fails.
    loop {
        let message = next_filed(&mut notifications).await;

        if let NotificationMessage::BackupFailed { app, .. } = message {
            assert_eq!(app, "beta");
            break;
        }
    }

    Ok(())
}
