//! GitHub's route, `github-releases`' service, on a fake GitHub.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Services as _;
use hangar_api::{GithubData, GithubRead, GithubRelease};
use hangar_server::Settings;
use http::StatusCode;
use serde_json::json;

use super::{Calls, Fixture};

/// A GitHub on port 0 with a release of `4thlabs/hangar` and one of `glanceapp/glance`, and none of any other
/// repository; it counts its calls; its URL.
async fn github(calls: Calls) -> String {
    let router = axum::Router::new()
        .route("/repos/{owner}/{repo}/releases/latest", get(latest))
        .with_state(calls);

    quoll::test::spawn(router).await
}

async fn latest(
    State(calls): State<Calls>,
    Path((owner, repo)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    calls.count();

    assert_eq!(headers["accept"], "application/vnd.github+json");
    assert_eq!(headers["authorization"], "Bearer github-token");

    let (tag, published_at) = match (owner.as_str(), repo.as_str()) {
        ("4thlabs", "hangar") => ("v1.0.0", "2026-11-20T10:00:00Z"),
        ("glanceapp", "glance") => ("v0.9.0", "2026-11-25T10:00:00Z"),
        _ => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "message": "Not Found" })),
            )
                .into_response();
        }
    };

    Json(json!({
        "tag_name": tag,
        "html_url": format!("https://github.com/{owner}/{repo}/releases/tag/{tag}"),
        "published_at": published_at,
        "name": tag,
    }))
    .into_response()
}

fn release(repository: &str, tag: &str, published_at: &str) -> GithubRelease {
    GithubRelease {
        repository: repository.to_owned(),
        tag: tag.to_owned(),
        url: format!("https://github.com/{repository}/releases/tag/{tag}"),
        published_at: published_at.to_owned(),
    }
}

#[tokio::test]
async fn reads_the_latest_release_of_each_repository_in_its_order_and_leaves_one_without_out()
-> quoll::Result<()> {
    let calls = Calls::default();
    let url = github(calls.clone()).await;
    let fixture = Fixture::new(
        "  - { type: github-releases, column: 3, repositories: [4thlabs/hangar, 4thlabs/none, glanceapp/glance] }\n  \
         - { type: github-releases, column: 2, repositories: [glanceapp/glance] }\n",
    );
    let server = fixture
        .serve_with(
            &[("GITHUB_TOKEN", "github-token")],
            |settings: &mut Settings| {
                settings.github_api_url = url;
            },
        )
        .await;
    let placements = server.placements().await;

    let read = GithubRead { releases: true };
    let first = server
        .api()
        .services()
        .github(&placements[0].key, read)
        .await?;
    let second = server
        .api()
        .services()
        .github(&placements[1].key, read)
        .await?;

    assert_eq!(
        first,
        GithubData {
            releases: Some(vec![
                release("4thlabs/hangar", "v1.0.0", "2026-11-20T10:00:00Z"),
                release("glanceapp/glance", "v0.9.0", "2026-11-25T10:00:00Z"),
            ]),
        }
    );
    assert_eq!(
        second,
        GithubData {
            releases: Some(vec![release(
                "glanceapp/glance",
                "v0.9.0",
                "2026-11-25T10:00:00Z"
            )]),
        }
    );
    assert_eq!(
        calls.get(),
        3,
        "the second placement reads glance's release the first kept"
    );
    Ok(())
}
