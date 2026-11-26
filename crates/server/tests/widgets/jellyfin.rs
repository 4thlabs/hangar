//! `jellyfin-latest`, on a fake Jellyfin.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Widgets as _;
use hangar_api::{JellyfinCounts, JellyfinItem, JellyfinLatest, WidgetData};
use http::StatusCode;
use serde_json::json;

use super::{Fixture, Server};

/// What Jellyfin takes as the key of `.env.global`.
const AUTHORIZATION: &str = "MediaBrowser Token=\"jellyfin-key\"";

/// A Jellyfin on port 0, which answers its key alone; its URL.
async fn jellyfin() -> String {
    let router = axum::Router::new()
        .route("/Items/Counts", get(counts))
        .route("/Users", get(users))
        .route("/Items/Latest", get(latest))
        .route("/Items/{id}/Images/Primary", get(poster));

    quoll::test::spawn(router).await
}

fn refused(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .is_none_or(|key| key != AUTHORIZATION)
}

async fn counts(headers: HeaderMap) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!({ "MovieCount": 120, "SeriesCount": 30, "EpisodeCount": 900, "SongCount": 4000, "BookCount": 2 }))
        .into_response()
}

async fn users(headers: HeaderMap) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(json!([{ "Id": "u-ben", "Name": "ben" }, { "Id": "u-ana", "Name": "ana" }]))
        .into_response()
}

async fn latest(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    assert_eq!(query["userId"], "u-ana");
    assert_eq!(query["limit"], "100");
    assert_eq!(query["includeItemTypes"], "Movie,Episode,MusicAlbum");
    assert_eq!(query["groupItems"], "true");

    Json(json!([
        { "Id": "e1", "Name": "Pilot", "Type": "Episode", "SeriesId": "s1", "SeriesName": "A Show", "ImageTags": {} , "ParentPrimaryImageItemId": "s1" },
        { "Id": "e2", "Name": "Second", "Type": "Episode", "SeriesId": "s1", "SeriesName": "A Show" },
        { "Id": "m1", "Name": "A Film", "Type": "Movie", "ProductionYear": 2024, "ImageTags": { "Primary": "tag" } },
        { "Id": "a1", "Name": "An Album", "Type": "MusicAlbum", "AlbumArtist": "A Band" },
    ]))
    .into_response()
}

async fn poster(Path(id): Path<String>, headers: HeaderMap) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match id.as_str() {
        "m1" => ([(CONTENT_TYPE, "image/webp")], "webp bytes").into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The server of a store whose Jellyfin is at `url`, its latest those of `user`.
async fn serve(url: &str, user: &str) -> (Fixture, Server) {
    let fixture = Fixture::new(&format!(
        "  - {{ type: jellyfin-latest, column: 2, user: {user}, url: '{url}' }}\n"
    ));

    fixture.env("JELLYFIN_API_KEY=jellyfin-key\n");

    let server = fixture.serve().await;

    (fixture, server)
}

#[tokio::test]
async fn reads_the_counts_and_the_latest_items_of_the_user_each_series_once() -> quoll::Result<()> {
    let url = jellyfin().await;
    let (_fixture, server) = serve(&url, "ana").await;
    let key = server.key("jellyfin-latest").await;

    let data = server.api().widgets().data(&key).await?;

    assert_eq!(
        data,
        WidgetData::JellyfinLatest(JellyfinLatest {
            counts: JellyfinCounts {
                movies: 120,
                series: 30,
                episodes: 900,
                songs: 4000,
            },
            items: vec![
                JellyfinItem {
                    id: "s1".to_owned(),
                    image_id: Some("s1".to_owned()),
                    title: "A Show".to_owned(),
                    subtitle: None,
                },
                JellyfinItem {
                    id: "m1".to_owned(),
                    image_id: Some("m1".to_owned()),
                    title: "A Film".to_owned(),
                    subtitle: Some("2024".to_owned()),
                },
                JellyfinItem {
                    id: "a1".to_owned(),
                    image_id: None,
                    title: "An Album".to_owned(),
                    subtitle: Some("A Band".to_owned()),
                },
            ],
        })
    );
    Ok(())
}

#[tokio::test]
async fn fails_for_a_user_jellyfin_does_not_have() {
    let url = jellyfin().await;
    let (_fixture, server) = serve(&url, "zoe").await;
    let key = server.key("jellyfin-latest").await;

    assert_eq!(
        server.problem(&format!("/api/widgets/{key}")).await,
        (
            StatusCode::BAD_GATEWAY,
            Some("widgets.unavailable".to_owned())
        )
    );
}

#[tokio::test]
async fn relays_a_poster_with_the_key_and_answers_404_for_one_it_has_not() {
    let url = jellyfin().await;
    let (_fixture, server) = serve(&url, "ana").await;
    let key = server.key("jellyfin-latest").await;

    let (status, headers, body) = server.get(&format!("/api/widgets/{key}/image/m1")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[CONTENT_TYPE], "image/webp");
    assert_eq!(body, b"webp bytes");
    assert_eq!(
        server
            .problem(&format!("/api/widgets/{key}/image/a1"))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}
