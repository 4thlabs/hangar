//! Jellyfin's route, `jellyfin-latest`'s service, on a fake Jellyfin, and the relay of its posters.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Services as _;
use hangar_api::{JellyfinCounts, JellyfinData, JellyfinItem, JellyfinRead, Limit};
use http::StatusCode;
use serde_json::json;

use super::{Fixture, Server};

/// What Jellyfin takes as the key of `.env.global`.
const AUTHORIZATION: &str = "MediaBrowser Token=\"jellyfin-key\"";

/// The calls a fake Jellyfin answered, by route, with the limit of each call of the latest items.
#[derive(Debug, Clone, Default)]
struct Calls(Arc<Mutex<Vec<String>>>);

impl Calls {
    fn push(&self, call: impl Into<String>) {
        self.0.lock().expect("not poisoned").push(call.into());
    }

    fn all(&self) -> Vec<String> {
        self.0.lock().expect("not poisoned").clone()
    }
}

/// A Jellyfin on port 0, which answers its key alone and counts its calls; its URL.
async fn jellyfin(calls: Calls) -> String {
    let router = axum::Router::new()
        .route("/Items/Counts", get(counts))
        .route("/Users", get(users))
        .route("/Items/Latest", get(latest))
        .route("/Items/{id}/Images/Primary", get(poster))
        .with_state(calls);

    quoll::test::spawn(router).await
}

fn refused(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .is_none_or(|key| key != AUTHORIZATION)
}

async fn counts(State(calls): State<Calls>, headers: HeaderMap) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    calls.push("counts");

    Json(json!({ "MovieCount": 120, "SeriesCount": 30, "EpisodeCount": 900, "SongCount": 4000, "BookCount": 2 }))
        .into_response()
}

async fn users(State(calls): State<Calls>, headers: HeaderMap) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    calls.push("users");

    Json(json!([{ "Id": "u-ben", "Name": "ben" }, { "Id": "u-ana", "Name": "ana" }]))
        .into_response()
}

async fn latest(
    State(calls): State<Calls>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    calls.push(format!("latest {}", query["limit"]));
    assert_eq!(query["userId"], "u-ana");
    assert_eq!(query["includeItemTypes"], "Movie,Episode,MusicAlbum");
    assert_eq!(query["groupItems"], "true");

    Json(json!([
        { "Id": "e1", "Name": "Pilot", "Type": "Episode", "SeriesId": "s1", "SeriesName": "A Show", "ImageTags": {}, "ParentPrimaryImageItemId": "s1" },
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
        "svg" => ([(CONTENT_TYPE, "image/svg+xml")], "<svg/>").into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The server of a store whose Jellyfin is at `url`, its latest those of `user`, beside a Frigate widget.
async fn serve(url: &str, user: &str) -> (Fixture, Server) {
    let fixture = Fixture::new(&format!(
        "  - {{ type: jellyfin-latest, column: 2, user: {user}, url: '{url}' }}\n  - {{ type: frigate-events, \
         column: 3, url: '{url}' }}\n"
    ));

    fixture.env("JELLYFIN_API_KEY=jellyfin-key\n");

    let server = fixture.serve().await;

    (fixture, server)
}

fn limit(count: u32) -> Option<Limit<100>> {
    Some(Limit::new(count).expect("within the cap"))
}

fn items() -> Vec<JellyfinItem> {
    let item = |id: &str, kind: &str, name: &str| JellyfinItem {
        id: id.to_owned(),
        kind: kind.to_owned(),
        name: name.to_owned(),
        series_id: None,
        series_name: None,
        album_artist: None,
        production_year: None,
        image_id: None,
    };

    vec![
        JellyfinItem {
            series_id: Some("s1".to_owned()),
            series_name: Some("A Show".to_owned()),
            image_id: Some("poster.s1".to_owned()),
            ..item("e1", "Episode", "Pilot")
        },
        JellyfinItem {
            production_year: Some(2024),
            image_id: Some("poster.m1".to_owned()),
            ..item("m1", "Movie", "A Film")
        },
        JellyfinItem {
            album_artist: Some("A Band".to_owned()),
            ..item("a1", "MusicAlbum", "An Album")
        },
    ]
}

#[tokio::test]
async fn gives_the_parts_a_read_asks_and_only_those() -> quoll::Result<()> {
    let calls = Calls::default();
    let url = jellyfin(calls.clone()).await;
    let (_fixture, server) = serve(&url, "ana").await;
    let key = server.key("jellyfin-latest").await;
    let services = server.api();

    let counted = services
        .services()
        .jellyfin(
            &key,
            JellyfinRead {
                counts: true,
                latest: None,
            },
        )
        .await?;

    assert_eq!(
        counted,
        JellyfinData {
            counts: Some(JellyfinCounts {
                movies: 120,
                series: 30,
                episodes: 900,
                songs: 4000,
            }),
            latest: None,
        }
    );
    assert_eq!(calls.all(), ["counts"]);

    let latest = services
        .services()
        .jellyfin(
            &key,
            JellyfinRead {
                counts: false,
                latest: limit(100),
            },
        )
        .await?;

    assert_eq!(
        latest,
        JellyfinData {
            counts: None,
            latest: Some(items()),
        }
    );
    assert_eq!(calls.all(), ["counts", "users", "latest 100"]);
    Ok(())
}

#[tokio::test]
async fn makes_one_call_for_two_reads_of_it_and_another_for_another_limit() -> quoll::Result<()> {
    let calls = Calls::default();
    let url = jellyfin(calls.clone()).await;
    let (_fixture, server) = serve(&url, "ana").await;
    let key = server.key("jellyfin-latest").await;
    let services = server.api();
    let read = |count| JellyfinRead {
        counts: true,
        latest: limit(count),
    };

    services.services().jellyfin(&key, read(10)).await?;
    services.services().jellyfin(&key, read(10)).await?;

    let mut made = calls.all();

    made.sort();
    assert_eq!(made, ["counts", "latest 10", "users"]);

    services.services().jellyfin(&key, read(20)).await?;

    let mut made = calls.all();

    made.sort();
    assert_eq!(
        made,
        ["counts", "latest 10", "latest 20", "users", "users"],
        "the counts kept, the latest items asked again for 20"
    );
    Ok(())
}

#[tokio::test]
async fn refuses_a_limit_past_its_part_s_cap() {
    let url = jellyfin(Calls::default()).await;
    let (_fixture, server) = serve(&url, "ana").await;
    let key = server.key("jellyfin-latest").await;

    for latest in ["0", "101", "ten"] {
        let (status, _, _) = server
            .get(&format!("/api/services/jellyfin/{key}?latest={latest}"))
            .await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{latest}");
    }
}

#[tokio::test]
async fn answers_404_for_the_key_of_another_service_s_widget() {
    let url = jellyfin(Calls::default()).await;
    let (_fixture, server) = serve(&url, "ana").await;
    let frigate = server.key("frigate-events").await;

    for key in [frigate.as_str(), "jellyfin-latest-1"] {
        assert_eq!(
            server
                .problem(&format!("/api/services/jellyfin/{key}?counts=true"))
                .await,
            (
                StatusCode::NOT_FOUND,
                Some("widgets.unknown_placement".to_owned())
            ),
            "{key}"
        );
    }
}

#[tokio::test]
async fn fails_for_a_user_jellyfin_does_not_have() {
    let url = jellyfin(Calls::default()).await;
    let (_fixture, server) = serve(&url, "zoe").await;
    let key = server.key("jellyfin-latest").await;

    assert_eq!(
        server
            .problem(&format!("/api/services/jellyfin/{key}?latest=10"))
            .await,
        (
            StatusCode::BAD_GATEWAY,
            Some("widgets.unavailable".to_owned())
        )
    );
}

#[tokio::test]
async fn relays_a_poster_with_the_key_by_the_id_it_wrote() {
    let url = jellyfin(Calls::default()).await;
    let (_fixture, server) = serve(&url, "ana").await;
    let key = server.key("jellyfin-latest").await;

    let (status, headers, body) = server
        .get(&format!("/api/services/images/{key}/poster.m1"))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[CONTENT_TYPE], "image/webp");
    assert_eq!(body, b"webp bytes");
}

#[tokio::test]
async fn answers_404_for_an_image_it_would_not_relay() {
    let url = jellyfin(Calls::default()).await;
    let (_fixture, server) = serve(&url, "ana").await;
    let jellyfin = server.key("jellyfin-latest").await;
    let frigate = server.key("frigate-events").await;

    for path in [
        // Jellyfin has no poster of it.
        format!("{jellyfin}/poster.a1"),
        // No id the server writes.
        format!("{jellyfin}/m1"),
        format!("{jellyfin}/thumbnail.m1"),
        // A poster, of another widget than Jellyfin's.
        format!("{frigate}/poster.m1"),
        // Not a raster image.
        format!("{jellyfin}/poster.svg"),
    ] {
        assert_eq!(
            server
                .problem(&format!("/api/services/images/{path}"))
                .await,
            (
                StatusCode::NOT_FOUND,
                Some("widgets.unknown_image".to_owned())
            ),
            "{path}"
        );
    }
}
