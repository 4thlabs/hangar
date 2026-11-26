//! `arcane-general-stats`, on a fake Arcane.

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Widgets as _;
use hangar_api::{
    ArcaneActionItem, ArcaneGeneralStats, ArcaneVersion, ContainerCounts, ImageCounts,
    VolumeCounts, WidgetData,
};
use http::StatusCode;
use serde_json::{Value, json};

use super::Fixture;

/// An Arcane on port 0 whose dashboard answers `answer` to its key alone; its URL.
async fn arcane(answer: Value) -> String {
    let router = axum::Router::new()
        .route("/api/environments/0/dashboard", get(dashboard))
        .with_state(answer);

    quoll::test::spawn(router).await
}

async fn dashboard(State(answer): State<Value>, headers: HeaderMap) -> Response {
    if headers
        .get("x-api-key")
        .is_none_or(|key| key != "arcane-key")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(answer).into_response()
}

/// What the widget loads from an Arcane whose dashboard answers `answer`.
async fn stats(answer: Value) -> quoll::Result<WidgetData> {
    let url = arcane(answer).await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: arcane-general-stats, column: 1, url: '{url}' }}\n"
    ));

    fixture.env("ARCANE_API_KEY=arcane-key\n");

    let server = fixture.serve().await;
    let key = server.key("arcane-general-stats").await;

    server.api().widgets().data(&key).await
}

#[tokio::test]
async fn reads_the_host_of_arcane_s_own_environment() -> quoll::Result<()> {
    let data = stats(json!({
        "success": true,
        "data": {
            "versionInfo": {
                "updateAvailable": true,
                "releaseUrl": "https://github.com/getarcaneapp/arcane/releases/tag/v1.2.0",
                "displayVersion": "v1.1.0",
                "newestVersion": "v1.2.0",
                "currentVersion": "1.1.0",
            },
            "containers": { "counts": { "totalContainers": 12, "runningContainers": 10, "stoppedContainers": 2 } },
            "imageUsageCounts": { "totalImages": 20, "imagesUnused": 3, "totalImageSize": 4_000_000_000_u64 },
            "volumeUsageCounts": { "total": 8, "inuse": 6, "unused": 2 },
            "actionItems": { "items": [{ "kind": "image_update", "severity": "warning", "count": 4 }] },
        },
    }))
    .await?;

    assert_eq!(
        data,
        WidgetData::ArcaneGeneralStats(ArcaneGeneralStats {
            version: ArcaneVersion {
                current: "v1.1.0".to_owned(),
                newest: Some("v1.2.0".to_owned()),
                update_available: true,
                release_url: Some(
                    "https://github.com/getarcaneapp/arcane/releases/tag/v1.2.0".to_owned()
                ),
            },
            containers: ContainerCounts {
                total: 12,
                running: 10,
                stopped: 2,
            },
            images: ImageCounts {
                total: 20,
                unused: 3,
                size: 4_000_000_000,
            },
            volumes: VolumeCounts {
                total: 8,
                in_use: 6,
                unused: 2,
            },
            action_items: vec![ArcaneActionItem {
                kind: "image_update".to_owned(),
                severity: "warning".to_owned(),
                count: 4,
            }],
        })
    );
    Ok(())
}

/// A dashboard whose version is `version_info`.
fn a_dashboard(version_info: Value) -> Value {
    json!({
        "versionInfo": version_info,
        "containers": { "counts": { "totalContainers": 1, "runningContainers": 1, "stoppedContainers": 0 } },
        "imageUsageCounts": { "totalImages": 1, "imagesUnused": 0, "totalImageSize": 1 },
        "volumeUsageCounts": { "total": 0, "inuse": 0, "unused": 0 },
    })
}

#[tokio::test]
async fn reads_a_version_with_no_newest_nor_release_as_no_update() -> quoll::Result<()> {
    // As Arcane answers with its update checks off, or when GitHub failed it.
    let data = stats(json!({
        "success": true,
        "data": a_dashboard(json!({ "updateAvailable": false, "displayVersion": "v1.1.0-next" })),
    }))
    .await?;
    let WidgetData::ArcaneGeneralStats(stats) = data else {
        panic!("Arcane's data: {data:?}");
    };

    assert_eq!(
        stats.version,
        ArcaneVersion {
            current: "v1.1.0-next".to_owned(),
            newest: None,
            update_available: false,
            release_url: None,
        }
    );
    assert!(stats.action_items.is_empty());
    Ok(())
}

#[tokio::test]
async fn fails_on_an_answer_of_200_that_is_no_success_even_with_data() {
    let error = stats(json!({
        "success": false,
        "detail": "environment 0 is offline",
        "data": a_dashboard(json!({ "displayVersion": "v1.1.0" })),
    }))
    .await
    .expect_err("Arcane refused");

    assert_eq!(error.status(), Some(StatusCode::BAD_GATEWAY));
}
