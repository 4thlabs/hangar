//! Frigate's route, `frigate-events`'s service, on a fake Frigate, and the relay of its thumbnails.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Services as _;
use hangar_api::{FrigateData, FrigateDetector, FrigateEvent, FrigateRead, FrigateStats, Limit};
use http::StatusCode;
use serde_json::json;

use super::{Calls, Fixture};

/// The key `.env.global` gives Frigate.
const KEY: &str = "frigate-key";

/// A Frigate on port 0, which answers only with its key, and counts the calls for its events; its URL.
async fn frigate(calls: Calls) -> String {
    let router = axum::Router::new()
        .route("/api/events", get(events))
        .route("/api/stats", get(stats))
        .route("/api/events/{id}/thumbnail.jpg", get(thumbnail))
        .with_state(calls);

    quoll::test::spawn(router).await
}

/// Whether a request carries Frigate's key.
fn has_key(headers: &HeaderMap) -> bool {
    headers.get("x-api-key").is_some_and(|key| key == KEY)
}

async fn events(
    State(calls): State<Calls>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    calls.count();

    if !has_key(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    assert_eq!(query["limit"], "5");

    Json(json!([
        {
            "id": "1700000000.5-abc",
            "camera": "frigate_front_door",
            "label": "person",
            "sub_label": ["Ana", 0.92],
            "start_time": 1_700_000_000.5,
            "top_score": 0.8,
        },
        { "id": "1699990000.0-def", "camera": "garden", "label": "cat", "sub_label": null, "start_time": 1_699_990_000.0 },
    ]))
    .into_response()
}

async fn stats(headers: HeaderMap) -> Response {
    if !has_key(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    // Written as text: `json!` would sort the detectors, which come in the order of Frigate's config.
    (
        [(CONTENT_TYPE, "application/json")],
        r#"{
            "detection_fps": 4.25,
            "cameras": { "frigate_front_door": { "camera_fps": 5.0 }, "garden": {} },
            "detectors": { "tpu": { "inference_speed": 8.5, "pid": 42 }, "cpu": { "inference_speed": 30.0 } },
            "service": { "version": "0.14.1" }
        }"#,
    )
        .into_response()
}

async fn thumbnail(Path(id): Path<String>, headers: HeaderMap) -> Response {
    if !has_key(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match id.as_str() {
        "1700000000.5-abc" => ([(CONTENT_TYPE, "image/jpeg")], "jpeg bytes").into_response(),
        "a-page" => ([(CONTENT_TYPE, "text/html")], "<script>alert(1)</script>").into_response(),
        "an-svg" => (
            [(CONTENT_TYPE, "image/svg+xml")],
            "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
        )
            .into_response(),
        "no-type" => Response::new(Body::from("jpeg bytes")),
        "upper-case" => ([(CONTENT_TYPE, "Image/PNG")], "png bytes").into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// A read of the stats and of the five latest events.
fn latest() -> FrigateRead {
    FrigateRead {
        stats: true,
        events: Some(Limit::new(5).expect("within the cap")),
    }
}

/// A store whose Frigate, `frigate-nvr` in the store, is at `url`, with its key in `.env.global`.
fn fixture(url: &str) -> Fixture {
    let fixture = Fixture::new(&format!(
        "  - {{ type: frigate-events, column: 3, url: '{url}' }}\n"
    ));

    fixture
        .app(
            "frigate",
            "services:\n  frigate:\n    image: frigate\n    container_name: frigate-nvr\n",
        )
        .env(&format!("FRIGATE_NVR_API_KEY={KEY}\n"));

    fixture
}

#[tokio::test]
async fn loads_the_latest_events_and_the_stats_with_the_key_of_its_container() -> quoll::Result<()>
{
    let url = frigate(Calls::default()).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    let data = server.api().services().frigate(&key, latest()).await?;
    let stats = server
        .api()
        .services()
        .frigate(
            &key,
            FrigateRead {
                stats: true,
                events: None,
            },
        )
        .await?;

    assert_eq!(stats.events, None, "the events, not asked, are not read");
    assert_eq!(stats.stats, data.stats);
    assert_eq!(
        data,
        FrigateData {
            stats: Some(FrigateStats {
                camera_count: 2,
                detection_fps: 4.25,
                detectors: vec![
                    FrigateDetector {
                        name: "tpu".to_owned(),
                        inference_speed: 8.5,
                    },
                    FrigateDetector {
                        name: "cpu".to_owned(),
                        inference_speed: 30.0,
                    },
                ],
            }),
            events: Some(vec![
                FrigateEvent {
                    id: "1700000000.5-abc".to_owned(),
                    thumbnail_id: "thumbnail.1700000000.5-abc".to_owned(),
                    camera: "frigate_front_door".to_owned(),
                    label: "person".to_owned(),
                    sub_label: Some("Ana".to_owned()),
                    start_time: "2023-11-14T22:13:20.500Z".to_owned(),
                },
                FrigateEvent {
                    id: "1699990000.0-def".to_owned(),
                    thumbnail_id: "thumbnail.1699990000.0-def".to_owned(),
                    camera: "garden".to_owned(),
                    label: "cat".to_owned(),
                    sub_label: None,
                    start_time: "2023-11-14T19:26:40.000Z".to_owned(),
                },
            ]),
        }
    );
    Ok(())
}

#[tokio::test]
async fn keeps_what_it_loaded_for_the_next_reader() -> quoll::Result<()> {
    let calls = Calls::default();
    let url = frigate(calls.clone()).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    let first = server.api().services().frigate(&key, latest()).await?;
    let second = server.api().services().frigate(&key, latest()).await?;

    assert_eq!(first, second);
    assert_eq!(calls.get(), 1, "the second read is served from the cache");
    Ok(())
}

#[tokio::test]
async fn answers_502_with_its_code_when_the_service_does_not_answer() {
    let fixture = fixture("http://127.0.0.1:9");
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    assert_eq!(
        server
            .problem(&format!("/api/services/frigate/{key}?stats=true"))
            .await,
        (
            StatusCode::BAD_GATEWAY,
            Some("widgets.unavailable".to_owned())
        )
    );
}

#[tokio::test]
async fn answers_502_when_the_service_refuses_a_missing_key() {
    let url = frigate(Calls::default()).await;
    let fixture = fixture(&url);

    fixture.env("");

    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;
    let (status, _) = server
        .problem(&format!("/api/services/frigate/{key}?stats=true"))
        .await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn relays_a_thumbnail_kept_a_day_by_the_browser() {
    let url = frigate(Calls::default()).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    let (status, headers, body) = server
        .get(&format!(
            "/api/services/images/{key}/thumbnail.1700000000.5-abc"
        ))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[CONTENT_TYPE], "image/jpeg");
    assert_eq!(headers[CACHE_CONTROL], "private, max-age=86400");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(body, b"jpeg bytes");
}

#[tokio::test]
async fn relays_an_image_of_no_type_as_a_jpeg_and_one_of_its_type_in_any_case() {
    let url = frigate(Calls::default()).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    let (status, headers, _) = server
        .get(&format!("/api/services/images/{key}/thumbnail.no-type"))
        .await;

    assert_eq!(
        (status, &headers[CONTENT_TYPE]),
        (StatusCode::OK, &"image/jpeg".parse().expect("a header"))
    );
    // Sent as a JPEG, never sniffed: bytes of no type that are a page are not run as one.
    assert_eq!(headers["x-content-type-options"], "nosniff");

    let (status, headers, _) = server
        .get(&format!("/api/services/images/{key}/thumbnail.upper-case"))
        .await;

    assert_eq!(
        (status, &headers[CONTENT_TYPE]),
        (StatusCode::OK, &"Image/PNG".parse().expect("a header"))
    );
}

#[tokio::test]
async fn answers_404_for_an_image_the_service_has_not_or_that_is_none() {
    let url = frigate(Calls::default()).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    // An SVG may hold a script, which would run on Hangar's origin, with its session.
    for id in ["unknown", "a-page", "an-svg", "a%2F..%2Fstats", "a%20b"] {
        assert_eq!(
            server
                .problem(&format!("/api/services/images/{key}/thumbnail.{id}"))
                .await,
            (
                StatusCode::NOT_FOUND,
                Some("widgets.unknown_image".to_owned())
            ),
            "{id}"
        );
    }
}

#[tokio::test]
async fn sends_the_new_key_once_env_global_changes_it() {
    let keys = Arc::new(Mutex::new(Vec::new()));
    let router = axum::Router::new()
        .route(
            "/api/events/{id}/thumbnail.jpg",
            get(
                |State(keys): State<Arc<Mutex<Vec<String>>>>, headers: HeaderMap| async move {
                    let key = headers
                        .get("x-api-key")
                        .and_then(|key| key.to_str().ok())
                        .unwrap_or_default()
                        .to_owned();

                    keys.lock().expect("no test panics with the lock").push(key);

                    ([(CONTENT_TYPE, "image/jpeg")], "jpeg bytes")
                },
            ),
        )
        .with_state(Arc::clone(&keys));
    let url = quoll::test::spawn(router).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;
    let thumbnail = format!("/api/services/images/{key}/thumbnail.1700000000.5-abc");

    assert_eq!(server.get(&thumbnail).await.0, StatusCode::OK);
    assert_eq!(server.get(&thumbnail).await.0, StatusCode::OK);

    fixture.env("FRIGATE_NVR_API_KEY=rotated-key\n");

    assert_eq!(server.get(&thumbnail).await.0, StatusCode::OK);
    assert_eq!(
        *keys.lock().expect("no test panics with the lock"),
        [KEY, KEY, "rotated-key"]
    );
}

#[tokio::test]
async fn refuses_more_events_than_its_part_gives() {
    let url = frigate(Calls::default()).await;
    let fixture = fixture(&url);
    let server = fixture.serve().await;
    let key = server.key("frigate-events").await;

    for events in ["0", "51"] {
        let (status, _, _) = server
            .get(&format!("/api/services/frigate/{key}?events={events}"))
            .await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{events}");
    }
}

#[tokio::test]
async fn relays_a_thumbnail_for_frigate_s_widget_alone() {
    let url = frigate(Calls::default()).await;
    // A Jellyfin at Frigate's address: a thumbnail asked through it would be found, were the relay to fetch it.
    let fixture = Fixture::new(&format!(
        "  - {{ type: frigate-events, column: 3, url: '{url}' }}\n  - {{ type: jellyfin-latest, column: 2, user: ana, \
         url: '{url}' }}\n"
    ));

    fixture.env(&format!("FRIGATE_API_KEY={KEY}\nJELLYFIN_API_KEY={KEY}\n"));

    let server = fixture.serve().await;
    let frigate = server.key("frigate-events").await;
    let jellyfin = server.key("jellyfin-latest").await;
    let thumbnail = "thumbnail.1700000000.5-abc";

    assert_eq!(
        server
            .get(&format!("/api/services/images/{frigate}/{thumbnail}"))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .problem(&format!("/api/services/images/{jellyfin}/{thumbnail}"))
            .await,
        (
            StatusCode::NOT_FOUND,
            Some("widgets.unknown_image".to_owned())
        )
    );
}
