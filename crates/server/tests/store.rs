//! The store's routes, served on port 0 and called by reqwest with a session: its apps, installed and uninstalled
//! against a fake `docker` first in the runtime's `PATH`, `hangar.yml`, `.env.global`, and the start of a sync.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use cookie::Cookie;
use hangar_core::{PasswordHash, Runtime};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{CACHE_CONTROL, COOKIE, ORIGIN, SET_COOKIE};
use serde_json::{Value, json};

const URL: &str = "https://hangar.example.com";

/// The fake `docker`: it logs its arguments, one call per line, and fails with code 1 on the project that
/// `HANGAR_TEST_FAIL` names.
const FAKE_DOCKER: &str = r#"#!/bin/sh
echo "$*" >> "$HANGAR_TEST_LOG"
project=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "-p" ]; then project="$arg"; fi
  previous="$arg"
done
if [ "$project" = "${HANGAR_TEST_FAIL:-none}" ]; then echo "$project: no such container" >&2; exit 1; fi
"#;

/// A data directory with a store of three apps, `alpha` installed, `beta` and `gamma` not, and the shared
/// `networks.yml`; the fake `docker`, and the log of its calls.
struct Fixture {
    dir: tempfile::TempDir,
    data: PathBuf,
    log: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data = dir.path().join("data");
        let store = data.join("app-store");
        let bin = dir.path().join("bin");

        fs::create_dir_all(store.join(".git")).expect("created");
        fs::create_dir_all(store.join("config")).expect("created");

        for (app, compose) in [
            (
                "alpha",
                "x-hangar:\n  name: Alpha\n  icon: alpha.svg\nservices:\n  alpha:\n    image: alpha:${ALPHA_TAG}\n",
            ),
            ("beta", "services:\n  beta:\n    image: beta:${BETA_TAG}\n"),
            ("gamma", "name: Gamma\nservices: {}\n"),
        ] {
            fs::create_dir_all(store.join("store").join(app)).expect("created");
            fs::write(store.join("store").join(app).join("compose.yml"), compose).expect("written");
        }

        fs::write(
            store.join("store/gamma/compose.swarm.yml"),
            "services: {}\n",
        )
        .expect("written");
        fs::write(store.join("store/networks.yml"), "networks: {}\n").expect("written");
        fs::create_dir_all(data.join("app-installed")).expect("created");
        std::os::unix::fs::symlink(store.join("store/alpha"), data.join("app-installed/alpha"))
            .expect("linked");

        let fixture = Self {
            log: dir.path().join("docker.log"),
            dir,
            data,
        };

        fixture.write_config("categories:\n  - { name: Apps, color: blue, stacks: [alpha] }\nshared: [networks.yml]\n");
        fs::create_dir_all(&bin).expect("created");
        fs::write(bin.join("docker"), FAKE_DOCKER).expect("written");
        fs::set_permissions(bin.join("docker"), fs::Permissions::from_mode(0o755))
            .expect("made executable");

        fixture
    }

    /// Writes `hangar.yml`: `source`, and Ana, who signs in by password.
    fn write_config(&self, source: &str) {
        fs::write(self.config_file(), format!("{source}{}", Self::users())).expect("written");
    }

    /// The users of every `hangar.yml` of the tests.
    fn users() -> String {
        let hash = PasswordHash::new("correct horse").expect("hashed");

        format!("users:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n")
    }

    fn config_file(&self) -> PathBuf {
        self.data.join("app-store/config/hangar.yml")
    }

    fn installed(&self, app: &str) -> bool {
        self.data.join("app-installed").join(app).is_symlink()
    }

    /// The calls of the fake `docker`, one per line.
    fn docker_calls(&self) -> Vec<String> {
        fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Serves the server on port 0, its `docker` the fake one, failing on `fail`; and signs Ana in.
    async fn serve(&self, fail: Option<&str>) -> Server {
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
            ("HANGAR_TEST_FAIL", fail.unwrap_or("none").to_owned()),
        ]);
        let app = App::with_runtime(&settings, runtime);
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
    /// A request of `method` to `path`, with the session, from the page's origin.
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        reqwest::Client::new()
            .request(method, format!("{}{path}", self.url))
            .header(COOKIE, &self.cookie)
            .header(ORIGIN, URL)
    }

    /// `GET path`'s status and JSON.
    async fn get(&self, path: &str) -> (StatusCode, Value) {
        Self::read(self.request(reqwest::Method::GET, path).send().await).await
    }

    /// `POST path`'s status and JSON.
    async fn post(&self, path: &str) -> (StatusCode, Value) {
        Self::read(self.request(reqwest::Method::POST, path).send().await).await
    }

    /// `PUT path` with `body`, its status and JSON.
    async fn put(&self, path: &str, body: &Value) -> (StatusCode, Value) {
        Self::read(
            self.request(reqwest::Method::PUT, path)
                .json(body)
                .send()
                .await,
        )
        .await
    }

    async fn read(response: reqwest::Result<reqwest::Response>) -> (StatusCode, Value) {
        let response = response.expect("the server answers");
        let status = response.status();
        let body = response.text().await.expect("a body");
        let json = if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&body).expect("JSON")
        };

        (status, json)
    }
}

/// The ids of the apps of a listing.
fn ids(listing: &Value) -> Vec<&str> {
    listing["apps"]
        .as_array()
        .expect("apps")
        .iter()
        .map(|app| app["id"].as_str().expect("an id"))
        .collect()
}

#[tokio::test]
async fn the_store_s_routes_take_a_session() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    for path in ["/api/store", "/api/store/apps", "/api/config", "/api/env"] {
        let response = reqwest::get(format!("{}{path}", server.url))
            .await
            .expect("the server answers");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn lists_the_apps_of_the_filters_with_the_counts_of_every_app() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    let (status, all) = server.get("/api/store/apps").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        ids(&all),
        ["alpha", "beta", "gamma"],
        "the shared file is no app"
    );
    assert_eq!(all["counts"], json!({ "installed": 1, "available": 2 }));
    assert_eq!(
        all["apps"][0],
        json!({ "id": "alpha", "name": "Alpha", "icon": "alpha.svg", "installed": true, "swarmReady": false })
    );
    assert_eq!(all["apps"][2]["swarmReady"], true);

    let (_, available) = server.get("/api/store/apps?filter=available").await;
    let (_, both) = server
        .get("/api/store/apps?filter=installed,available")
        .await;

    assert_eq!(ids(&available), ["beta", "gamma"]);
    assert_eq!(available["counts"], all["counts"]);
    assert_eq!(ids(&both), ["alpha", "beta", "gamma"]);
}

#[tokio::test]
async fn installs_an_app_and_seeds_the_variables_it_references() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    let (status, beta) = server.post("/api/store/apps/beta/install").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(beta["installed"], true);
    assert!(fixture.installed("beta"));
    assert!(
        fs::read_to_string(fixture.data.join(".env.global"))
            .expect("seeded")
            .contains("BETA_TAG="),
    );

    let (again, _) = server.post("/api/store/apps/beta/install").await;

    assert_eq!(
        again,
        StatusCode::OK,
        "an app installed already is left as it is"
    );
}

#[tokio::test]
async fn an_app_the_store_does_not_carry_is_a_404() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    for path in [
        "/api/store/apps/delta/install",
        "/api/store/apps/networks.yml/install",
        "/api/store/apps/delta/uninstall",
    ] {
        let (status, problem) = server.post(path).await;

        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        assert!(
            problem["detail"]
                .as_str()
                .expect("a detail")
                .starts_with("the store has no app "),
            "{problem}"
        );
    }
}

#[tokio::test]
async fn uninstalls_an_app_once_compose_has_taken_it_down() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    let (status, alpha) = server.post("/api/store/apps/alpha/uninstall").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(alpha["installed"], false);
    assert!(!fixture.installed("alpha"));

    let calls = fixture.docker_calls();

    assert_eq!(calls.len(), 1, "{calls:?}");
    let down = &calls[0];

    assert!(down.starts_with("compose --env-file "), "{down}");
    assert!(down.contains(" -p alpha -f "), "{down}");
    assert!(
        down.ends_with("/app-installed/alpha/compose.yml down"),
        "{down}"
    );
    assert!(
        fixture
            .data
            .join("app-store/store/alpha/compose.yml")
            .exists(),
        "its folder in the store is kept"
    );

    let (again, _) = server.post("/api/store/apps/alpha/uninstall").await;

    assert_eq!(
        again,
        StatusCode::OK,
        "an app not installed is left as it is"
    );
    assert_eq!(fixture.docker_calls().len(), 1, "and not taken down again");
}

#[tokio::test]
async fn an_app_compose_does_not_take_down_stays_installed() {
    let fixture = Fixture::new();
    let server = fixture.serve(Some("alpha")).await;

    let (status, problem) = server.post("/api/store/apps/alpha/uninstall").await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        problem["detail"],
        "the uninstallation of Alpha failed. See the server's log."
    );
    assert!(
        fixture.installed("alpha"),
        "the link is kept: compose still reaches it"
    );
}

#[tokio::test]
async fn uninstalls_an_app_the_store_no_longer_carries_by_its_link() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    fs::remove_dir_all(fixture.data.join("app-store/store/alpha")).expect("removed upstream");

    let (status, alpha) = server.post("/api/store/apps/alpha/uninstall").await;

    assert_eq!(status, StatusCode::OK, "{alpha}");
    assert_eq!(alpha["installed"], false);
    assert!(!fixture.installed("alpha"), "the dangling link is gone");
    assert!(
        fixture.docker_calls().is_empty(),
        "compose has no file left to read"
    );
}

#[tokio::test]
async fn uninstalls_an_app_whose_compose_file_no_longer_parses_even_when_compose_fails() {
    let fixture = Fixture::new();
    let server = fixture.serve(Some("alpha")).await;

    fs::write(
        fixture.data.join("app-store/store/alpha/compose.yml"),
        "services: [\n",
    )
    .expect("broken");

    let (status, _) = server.post("/api/store/apps/alpha/uninstall").await;

    assert_eq!(status, StatusCode::OK);
    assert!(
        !fixture.installed("alpha"),
        "the link is removed all the same"
    );
    assert!(
        fixture.docker_calls()[0].ends_with(" down"),
        "compose was asked to take it down first"
    );
}

#[tokio::test]
async fn an_invalid_hangar_yml_names_its_field_on_the_store_and_the_link_still_uninstalls() {
    let fixture = Fixture::new();

    fixture.write_config("categories:\n  - { name: Apps, stacks: [alpha] }\n");

    let server = fixture.serve(None).await;
    let (status, problem) = server.get("/api/store/apps").await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        problem["detail"]
            .as_str()
            .expect("a detail")
            .starts_with("invalid hangar.yml: categories[0].color: "),
        "{problem}"
    );

    let (install, _) = server.post("/api/store/apps/beta/install").await;
    let (uninstall, _) = server.post("/api/store/apps/alpha/uninstall").await;

    assert_eq!(install, StatusCode::BAD_REQUEST);
    assert_eq!(uninstall, StatusCode::OK);
    assert!(!fixture.installed("alpha"));
}

#[tokio::test]
async fn reads_and_saves_hangar_yml_and_links_what_it_lists() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    let (_, read) = server.get("/api/config").await;

    assert_eq!(
        read["source"].as_str(),
        fs::read_to_string(fixture.config_file()).ok().as_deref()
    );

    let saved = format!(
        "categories:\n  - {{ name: Apps, color: blue, stacks: [alpha, beta] }}\n{}",
        Fixture::users()
    );
    let (status, _) = server.put("/api/config", &json!({ "source": saved })).await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        fs::read_to_string(fixture.config_file()).expect("read"),
        saved
    );
    assert!(fixture.installed("beta"), "the new stack is linked");
}

#[tokio::test]
async fn an_invalid_hangar_yml_is_a_400_that_names_its_field_and_is_not_written() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;
    let before = fs::read_to_string(fixture.config_file()).expect("read");

    let (status, problem) = server
        .put(
            "/api/config",
            &json!({ "source": "categories:\n  - { name: Apps, stacks: [alpha] }\n" }),
        )
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        problem["detail"]
            .as_str()
            .expect("a detail")
            .starts_with("invalid hangar.yml: categories[0].color: "),
        "{problem}"
    );

    let (syntax, problem) = server
        .put("/api/config", &json!({ "source": "categories: [\n" }))
        .await;

    assert_eq!(syntax, StatusCode::BAD_REQUEST);
    assert!(
        problem["detail"]
            .as_str()
            .expect("a detail")
            .starts_with("hangar.yml is not valid YAML: "),
        "{problem}"
    );
    assert_eq!(
        fs::read_to_string(fixture.config_file()).expect("read"),
        before
    );
}

#[tokio::test]
async fn a_hangar_yml_whose_users_would_sign_nobody_in_is_refused_and_not_written() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;
    let before = fs::read_to_string(fixture.config_file()).expect("read");

    for (users, field) in [
        (
            "users:\n  - { name: Ana, email: not-an-email }\n",
            "users[0].email",
        ),
        (
            "users:\n  - { name: Ana, email: ana@example.com }\n  - { name: Bo, email: ANA@example.com }\n",
            "users[1].email",
        ),
    ] {
        let source = format!("categories: []\n{users}");
        let (status, problem) = server
            .put("/api/config", &json!({ "source": source }))
            .await;
        let detail = problem["detail"].as_str().expect("a detail");

        assert_eq!(status, StatusCode::BAD_REQUEST, "{problem}");
        assert!(
            detail.starts_with(&format!("invalid hangar.yml: {field}: ")),
            "{detail}"
        );
    }

    assert_eq!(
        fs::read_to_string(fixture.config_file()).expect("read"),
        before
    );
}

#[tokio::test]
async fn hangar_yml_is_not_saved_before_the_store_is_cloned() {
    let fixture = Fixture::new();

    fs::remove_dir(fixture.data.join("app-store/.git")).expect("removed");

    let server = fixture.serve(None).await;
    let (status, problem) = server
        .put("/api/config", &json!({ "source": "categories: []\n" }))
        .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        problem["detail"],
        "the store is not installed: install it from the settings first"
    );
}

#[tokio::test]
async fn saves_env_global_merged_into_what_is_on_disk_after_a_copy_aside() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;
    let env = fixture.data.join(".env.global");

    fs::write(&env, "OLD=1\nKEPT=by hand\n").expect("written");

    let (status, saved) = server
        .put(
            "/api/env",
            &json!({ "updates": { "ALPHA_TAG": "1.2", "SPACED": " padded " }, "remove": ["OLD"] }),
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        saved["variables"],
        json!({ "ALPHA_TAG": "1.2", "KEPT": "by hand", "SPACED": " padded " })
    );

    let response = server
        .request(reqwest::Method::GET, "/api/env")
        .send()
        .await
        .expect("the server answers");

    assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
    assert_eq!(
        response.json::<Value>().await.expect("JSON")["variables"],
        saved["variables"]
    );

    let copies = fs::read_dir(&fixture.data)
        .expect("listed")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".bak"))
        .count();

    assert_eq!(copies, 1, "the file was copied aside");
}

#[tokio::test]
async fn refuses_a_variable_compose_would_not_read_back_and_writes_nothing() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    for (changes, detail) in [
        (
            json!({ "updates": { "1BAD": "x" }, "remove": [] }),
            "invalid variable name: 1BAD",
        ),
        (
            json!({ "updates": { "INJECTED": "a\nB=c" } }),
            "the value of INJECTED cannot contain a line break",
        ),
        (
            json!({ "updates": { "BOTH": "x" }, "remove": ["BOTH"] }),
            "BOTH is both set and removed",
        ),
    ] {
        let (status, problem) = server.put("/api/env", &changes).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{changes}");
        assert_eq!(problem["detail"], detail);
    }

    assert!(
        !fixture.data.join(".env.global").exists(),
        "nothing was written"
    );
}

#[tokio::test]
async fn sets_and_removes_a_variable_the_file_holds_whatever_its_name() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    fs::write(fixture.data.join(".env.global"), "OLD-KEY=1\na.b=2\n").expect("written by hand");

    let (status, saved) = server
        .put(
            "/api/env",
            &json!({ "updates": { "OLD-KEY": "one" }, "remove": ["a.b"] }),
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["variables"], json!({ "OLD-KEY": "one" }));
}

#[tokio::test]
async fn a_save_that_changes_nothing_writes_nothing_and_copies_nothing_aside() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;
    let env = fixture.data.join(".env.global");

    fs::write(&env, "KEPT=1\n").expect("written by hand");

    let (status, _) = server
        .put(
            "/api/env",
            &json!({ "updates": { "KEPT": "1" }, "remove": ["GONE"] }),
        )
        .await;
    let backups = fs::read_dir(&fixture.data)
        .expect("listed")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".bak"))
        .count();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(fs::read_to_string(&env).expect("read"), "KEPT=1\n");
    assert_eq!(backups, 0);
}

#[tokio::test]
async fn a_sync_answers_once_started_and_the_store_reads_it_again() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    let (_, before) = server.get("/api/store").await;

    assert_eq!(
        before,
        json!({ "url": "https://example.com/store.git", "installed": true, "sync": null })
    );

    let (status, started) = server.post("/api/store/sync").await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(started["operation"], "update");
    assert_eq!(started["state"], "running");

    let (_, after) = server.get("/api/store").await;

    assert_eq!(after["sync"]["startedAt"], started["startedAt"]);
}

#[tokio::test]
async fn gives_the_template_of_a_new_app() {
    let fixture = Fixture::new();
    let server = fixture.serve(None).await;

    let (status, template) = server.get("/api/store/new-app").await;
    let compose = template["compose"].as_str().expect("a compose file");

    assert_eq!(status, StatusCode::OK);
    assert!(compose.contains("x-hangar:\n  icon: "), "{compose}");
    assert!(compose.contains("container_name: my-app"), "{compose}");
}
