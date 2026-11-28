//! Miniflux's route, `miniflux-entries`'s service, on a fake Miniflux.

use std::collections::HashMap;

use axum::Json;
use axum::extract::Query;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Services as _;
use hangar_api::{Limit, MinifluxData, MinifluxEntry, MinifluxRead};
use http::StatusCode;
use serde_json::json;

use super::Fixture;

/// A Miniflux on port 0, which answers its token alone: 42 entries unread, of which the newest is listed first; its
/// URL.
async fn miniflux() -> String {
    let router = axum::Router::new().route("/v1/entries", get(entries));

    quoll::test::spawn(router).await
}

async fn entries(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if headers
        .get("x-auth-token")
        .is_none_or(|key| key != "miniflux-token")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let entry = |id: u64, status: &str| {
        json!({
            "id": id,
            "title": format!("Entry {id}"),
            "url": format!("https://blog.example.com/{id}"),
            "published_at": "2026-11-25T08:00:00+01:00",
            "status": status,
            "feed": { "id": 3, "title": "A blog" },
        })
    };
    let answer = match query.get("status").map(String::as_str) {
        Some("unread") => {
            assert_eq!(query["limit"], "1");

            json!({ "total": 42, "entries": [entry(9, "unread")] })
        }
        _ => {
            assert_eq!(
                (
                    query["order"].as_str(),
                    query["direction"].as_str(),
                    query["limit"].as_str()
                ),
                ("published_at", "desc", "8")
            );

            json!({ "total": 100, "entries": [entry(9, "unread"), entry(8, "read")] })
        }
    };

    Json(answer).into_response()
}

#[tokio::test]
async fn reads_the_newest_entries_and_counts_the_unread_ones() -> quoll::Result<()> {
    let url = miniflux().await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: miniflux-entries, column: 2, url: '{url}' }}\n"
    ));

    fixture.env("MINIFLUX_API_KEY=miniflux-token\n");

    let server = fixture.serve().await;
    let key = server.key("miniflux-entries").await;

    let read = |unread, entries: Option<u32>| MinifluxRead {
        unread,
        entries: entries.map(|count| Limit::new(count).expect("within the cap")),
    };
    let data = server
        .api()
        .services()
        .miniflux(&key, read(true, Some(8)))
        .await?;
    let entry = |id: u64, is_unread: bool| MinifluxEntry {
        id,
        title: format!("Entry {id}"),
        url: format!("https://blog.example.com/{id}"),
        feed_title: "A blog".to_owned(),
        published_at: "2026-11-25T08:00:00+01:00".to_owned(),
        is_unread,
    };

    assert_eq!(
        data,
        MinifluxData {
            unread: Some(42),
            entries: Some(vec![entry(9, true), entry(8, false)]),
        }
    );
    assert_eq!(
        server
            .api()
            .services()
            .miniflux(&key, read(true, None))
            .await?,
        MinifluxData {
            unread: Some(42),
            entries: None,
        },
        "the entries, not asked, are not read"
    );
    Ok(())
}

#[tokio::test]
async fn refuses_more_entries_than_its_part_gives() {
    let url = miniflux().await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: miniflux-entries, column: 2, url: '{url}' }}\n"
    ));
    let server = fixture.serve().await;
    let key = server.key("miniflux-entries").await;
    let (status, _, _) = server
        .get(&format!("/api/services/miniflux/{key}?entries=101"))
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}
