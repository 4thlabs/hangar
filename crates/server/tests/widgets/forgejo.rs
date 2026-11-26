//! `forgejo-ci`, on a fake Forgejo.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, Query, RawQuery};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Widgets as _;
use hangar_api::{ForgejoCi, ForgejoRepository, ForgejoRun, WidgetData};
use http::StatusCode;
use serde_json::{Value, json};

use super::Fixture;

/// A repository as Forgejo lists it.
fn repository(full_name: &str, updated_at: &str, archived: bool, has_actions: bool) -> Value {
    json!({
        "full_name": full_name,
        "html_url": format!("https://forgejo.example.com/{full_name}"),
        "updated_at": updated_at,
        "archived": archived,
        "empty": false,
        "has_actions": has_actions,
        "stars_count": 3,
    })
}

/// A Forgejo on port 0, which answers its token alone. `ana` owns three repositories, one archived and one without
/// Actions; `ben` none it shows; the search finds a fourth, of `cleo`, whose runs fail.
async fn forgejo() -> String {
    let router = axum::Router::new()
        .route("/api/v1/repos/search", get(search))
        .route("/api/v1/users/{owner}/repos", get(owned))
        .route("/api/v1/repos/{owner}/{name}/actions/runs", get(runs));

    quoll::test::spawn(router).await
}

fn refused(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .is_none_or(|key| key != "token forgejo-token")
}

fn ana() -> Vec<Value> {
    vec![
        repository("ana/hangar", "2026-11-25T10:00:00+01:00", false, true),
        repository("ana/old", "2026-11-26T10:00:00Z", true, true),
        repository("ana/notes", "2026-11-20T10:00:00Z", false, false),
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

    found.push(repository("cleo/site", "2026-11-24T10:00:00Z", false, true));

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
    Path((owner, name)): Path<(String, String)>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

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
            run(2, "running", "2026-11-26T08:00:00Z", "2026-11-26T08:01:00Z"),
            run(3, "running", "2026-11-26T08:30:00Z", "2026-11-26T08:31:00Z"),
        ],
    }))
    .into_response()
}

/// What the widget loads from the Forgejo of `url`, for `owners` if given.
async fn ci(url: &str, owners: Option<&str>) -> quoll::Result<WidgetData> {
    let owners = owners.map_or_else(String::new, |owners| format!(", owners: {owners}"));
    let fixture = Fixture::new(&format!(
        "  - {{ type: forgejo-ci, column: 2, url: '{url}'{owners} }}\n"
    ));

    fixture.env("FORGEJO_API_KEY=forgejo-token\n");

    let server = fixture.serve().await;
    let key = server.key("forgejo-ci").await;

    server.api().widgets().data(&key).await
}

fn active_runs() -> Vec<ForgejoRun> {
    let run = |id: u64, status: &str, since: &str| ForgejoRun {
        id,
        repository: "ana/hangar".to_owned(),
        title: format!("Run {id}"),
        status: status.to_owned(),
        is_queued: status != "running",
        reference: "main".to_owned(),
        url: format!("https://forgejo.example.com/ana/hangar/actions/runs/{id}"),
        since: since.to_owned(),
    };

    vec![
        run(3, "running", "2026-11-26T08:31:00.000Z"),
        run(2, "running", "2026-11-26T08:01:00.000Z"),
        run(1, "waiting", "2026-11-26T09:00:00.000Z"),
    ]
}

fn recent(full_name: &str, updated_at: &str) -> ForgejoRepository {
    ForgejoRepository {
        full_name: full_name.to_owned(),
        url: format!("https://forgejo.example.com/{full_name}"),
        updated_at: updated_at.to_owned(),
    }
}

#[tokio::test]
async fn reads_the_runs_of_the_repositories_of_its_owners_running_first_and_skips_an_owner_it_cannot_see()
-> quoll::Result<()> {
    let url = forgejo().await;

    let data = ci(&url, Some("[ana, ben]")).await?;

    assert_eq!(
        data,
        WidgetData::ForgejoCi(ForgejoCi {
            repository_count: 3,
            active_runs: active_runs(),
            recent_repositories: vec![
                recent("ana/hangar", "2026-11-25T09:00:00.000Z"),
                recent("ana/notes", "2026-11-20T10:00:00.000Z"),
            ],
        })
    );
    Ok(())
}

#[tokio::test]
async fn reads_every_repository_the_key_sees_and_skips_one_whose_runs_fail() -> quoll::Result<()> {
    let url = forgejo().await;

    let data = ci(&url, None).await?;

    assert_eq!(
        data,
        WidgetData::ForgejoCi(ForgejoCi {
            repository_count: 4,
            active_runs: active_runs(),
            recent_repositories: vec![
                recent("ana/hangar", "2026-11-25T09:00:00.000Z"),
                recent("cleo/site", "2026-11-24T10:00:00.000Z"),
                recent("ana/notes", "2026-11-20T10:00:00.000Z"),
            ],
        })
    );
    Ok(())
}

#[tokio::test]
async fn fails_when_no_owner_can_be_read() {
    let url = forgejo().await;

    let error = ci(&url, Some("[ben]"))
        .await
        .expect_err("ben's repositories are not found");

    assert_eq!(error.status(), Some(StatusCode::BAD_GATEWAY));
}
