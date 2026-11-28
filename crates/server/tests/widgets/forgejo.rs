//! Forgejo's route, `forgejo-ci`'s service, on a fake Forgejo.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::{Path, Query, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Services as _;
use hangar_api::{ForgejoData, ForgejoRead, ForgejoRepository, ForgejoRun};
use http::StatusCode;
use serde_json::{Value, json};

use super::Fixture;

/// The repositories the fake was asked the runs of, in no order.
#[derive(Debug, Clone, Default)]
struct Asked(Arc<Mutex<Vec<String>>>);

impl Asked {
    fn sorted(&self) -> Vec<String> {
        let mut asked = self.0.lock().expect("no test panics with the lock").clone();

        asked.sort();

        asked
    }
}

/// A repository as Forgejo lists it.
fn repository(
    full_name: &str,
    updated_at: &str,
    archived: bool,
    has_actions: bool,
    empty: bool,
) -> Value {
    json!({
        "full_name": full_name,
        "html_url": format!("https://forgejo.example.com/{full_name}"),
        "updated_at": updated_at,
        "archived": archived,
        "empty": empty,
        "has_actions": has_actions,
        "stars_count": 3,
    })
}

/// A Forgejo on port 0, which answers its token alone, as a bearer. `ana` owns four repositories: one that runs
/// Actions, one archived, one without Actions and one empty; `ben` none it shows; the search finds a fifth, of
/// `cleo`, whose runs fail. Its URL.
async fn forgejo(asked: Asked) -> String {
    let router = axum::Router::new()
        .route("/api/v1/repos/search", get(search))
        .route("/api/v1/users/{owner}/repos", get(owned))
        .route("/api/v1/repos/{owner}/{name}/actions/runs", get(runs))
        .with_state(asked);

    quoll::test::spawn(router).await
}

fn refused(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .is_none_or(|key| key != "Bearer forgejo-token")
}

fn ana() -> Vec<Value> {
    vec![
        repository(
            "ana/hangar",
            "2026-11-25T10:00:00+01:00",
            false,
            true,
            false,
        ),
        repository("ana/old", "2026-11-26T10:00:00Z", true, true, false),
        repository("ana/notes", "2026-11-20T10:00:00Z", false, false, false),
        repository("ana/empty", "2026-11-01T10:00:00Z", false, true, true),
    ]
}

async fn search(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    assert_eq!(
        (query["limit"].as_str(), query["page"].as_str()),
        ("50", "1")
    );

    let mut found = ana();

    found.push(repository(
        "cleo/site",
        "2026-11-24T10:00:00Z",
        false,
        true,
        false,
    ));

    Json(json!({ "ok": true, "data": found })).into_response()
}

async fn owned(Path(owner): Path<String>, headers: HeaderMap) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match owner.as_str() {
        "ana" => Json(ana()).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn runs(
    State(asked): State<Asked>,
    Path((owner, name)): Path<(String, String)>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    asked
        .0
        .lock()
        .expect("no test panics with the lock")
        .push(format!("{owner}/{name}"));

    assert_eq!(
        query.as_deref(),
        Some("status=running&status=waiting&status=blocked&limit=50&page=1")
    );

    if (owner.as_str(), name.as_str()) != ("ana", "hangar") {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let run = |id: u64, status: &str, created: &str, started: &str| {
        json!({
            "id": id,
            "title": format!("Run {id}"),
            "status": status,
            "workflow_id": "ci.yml",
            "prettyref": "main",
            "html_url": format!("https://forgejo.example.com/ana/hangar/actions/runs/{id}"),
            "created": created,
            "started": started,
            "stopped": "0001-01-01T00:00:00Z",
            "repository": { "full_name": "ana/hangar" },
        })
    };

    Json(json!({
        "total_count": 3,
        "workflow_runs": [
            run(1, "waiting", "2026-11-26T09:00:00Z", "0001-01-01T00:00:00Z"),
            run(2, "running", "2026-11-26T08:00:00Z", "2026-11-26T08:40:00Z"),
            run(3, "running", "2026-11-26T08:30:00Z", "2026-11-26T08:31:00Z"),
        ],
    }))
    .into_response()
}

/// Both parts.
const BOTH: ForgejoRead = ForgejoRead {
    repositories: true,
    runs: true,
};

/// What `read` gives of the Forgejo of `url`, for `owners` if given.
async fn ci(url: &str, owners: Option<&str>, read: ForgejoRead) -> quoll::Result<ForgejoData> {
    let owners = owners.map_or_else(String::new, |owners| format!(", owners: {owners}"));
    let fixture = Fixture::new(&format!(
        "  - {{ type: forgejo-ci, column: 2, url: '{url}'{owners} }}\n"
    ));

    fixture.env("FORGEJO_API_KEY=forgejo-token\n");

    let server = fixture.serve().await;
    let key = server.key("forgejo-ci").await;

    server.api().services().forgejo(&key, read).await
}

/// The runs of `ana/hangar` that have not finished, as Forgejo lists them.
fn active_runs() -> Vec<ForgejoRun> {
    let run = |id: u64, status: &str, created: &str, started: Option<&str>| ForgejoRun {
        id,
        repository: "ana/hangar".to_owned(),
        title: format!("Run {id}"),
        status: status.to_owned(),
        reference: "main".to_owned(),
        url: format!("https://forgejo.example.com/ana/hangar/actions/runs/{id}"),
        created_at: created.to_owned(),
        started_at: started.map(str::to_owned),
    };

    vec![
        run(1, "waiting", "2026-11-26T09:00:00.000Z", None),
        run(
            2,
            "running",
            "2026-11-26T08:00:00.000Z",
            Some("2026-11-26T08:40:00.000Z"),
        ),
        run(
            3,
            "running",
            "2026-11-26T08:30:00.000Z",
            Some("2026-11-26T08:31:00.000Z"),
        ),
    ]
}

fn listed(full_name: &str, updated_at: &str, archived: bool) -> ForgejoRepository {
    ForgejoRepository {
        full_name: full_name.to_owned(),
        url: format!("https://forgejo.example.com/{full_name}"),
        updated_at: updated_at.to_owned(),
        archived,
    }
}

/// `ana`'s repositories, as Forgejo lists them.
fn anas() -> Vec<ForgejoRepository> {
    vec![
        listed("ana/hangar", "2026-11-25T09:00:00.000Z", false),
        listed("ana/old", "2026-11-26T10:00:00.000Z", true),
        listed("ana/notes", "2026-11-20T10:00:00.000Z", false),
        listed("ana/empty", "2026-11-01T10:00:00.000Z", false),
    ]
}

#[tokio::test]
async fn reads_the_runs_of_the_repositories_of_its_owners_that_run_actions_and_skips_an_owner_it_cannot_see()
-> quoll::Result<()> {
    let asked = Asked::default();
    let url = forgejo(asked.clone()).await;

    let data = ci(&url, Some("[ana, ben]"), BOTH).await?;

    assert_eq!(
        data,
        ForgejoData {
            repositories: Some(anas()),
            runs: Some(active_runs()),
        }
    );
    assert_eq!(
        asked.sorted(),
        ["ana/hangar"],
        "neither the archived, the empty, nor the one without Actions"
    );
    Ok(())
}

#[tokio::test]
async fn reads_every_repository_the_key_sees_and_skips_one_whose_runs_fail() -> quoll::Result<()> {
    let asked = Asked::default();
    let url = forgejo(asked.clone()).await;

    let data = ci(&url, None, BOTH).await?;
    let mut every = anas();

    every.push(listed("cleo/site", "2026-11-24T10:00:00.000Z", false));

    assert_eq!(
        data,
        ForgejoData {
            repositories: Some(every),
            runs: Some(active_runs()),
        }
    );
    assert_eq!(asked.sorted(), ["ana/hangar", "cleo/site"]);
    Ok(())
}

#[tokio::test]
async fn reads_the_repositories_alone_without_their_runs_and_the_runs_alone() -> quoll::Result<()> {
    let asked = Asked::default();
    let url = forgejo(asked.clone()).await;
    let repositories = ForgejoRead {
        repositories: true,
        runs: false,
    };
    let runs = ForgejoRead {
        repositories: false,
        runs: true,
    };

    assert_eq!(
        ci(&url, Some("[ana]"), repositories).await?,
        ForgejoData {
            repositories: Some(anas()),
            runs: None,
        }
    );
    assert!(asked.sorted().is_empty(), "no run asked");
    assert_eq!(
        ci(&url, Some("[ana]"), runs).await?,
        ForgejoData {
            repositories: None,
            runs: Some(active_runs()),
        }
    );
    Ok(())
}

#[tokio::test]
async fn fails_when_no_owner_can_be_read() {
    let url = forgejo(Asked::default()).await;

    let error = ci(&url, Some("[ben]"), BOTH)
        .await
        .expect_err("ben's repositories are not found");

    assert_eq!(error.status(), Some(StatusCode::BAD_GATEWAY));
}

#[tokio::test]
async fn keeps_the_runs_by_the_repositories_they_are_asked_of() -> quoll::Result<()> {
    let asked = Asked::default();
    let url = forgejo(asked.clone()).await;
    // ben has no repository Forgejo shows: both declarations ask the runs of ana's alone.
    let fixture = Fixture::new(&format!(
        "  - {{ type: forgejo-ci, column: 2, url: '{url}', owners: [ana] }}\n  - {{ type: forgejo-ci, column: 3, \
         url: '{url}', owners: [ana, ben] }}\n"
    ));

    fixture.env("FORGEJO_API_KEY=forgejo-token\n");

    let server = fixture.serve().await;

    for placement in server.placements().await {
        let data = server
            .api()
            .services()
            .forgejo(&placement.key, BOTH)
            .await?;

        assert_eq!(data.runs, Some(active_runs()));
    }

    assert_eq!(
        asked.sorted(),
        ["ana/hangar"],
        "one call of the same repositories' runs"
    );
    Ok(())
}
