//! `beszel-server-stats`, on a fake Beszel hub.

use std::collections::HashMap;

use axum::Json;
use axum::extract::Query;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Widgets as _;
use hangar_api::{BeszelServerStats, BeszelSystem, WidgetData};
use http::StatusCode;
use serde_json::json;

use super::Fixture;

/// A hub on port 0, which lists a system up and one that never reported to its token alone; its URL.
async fn beszel() -> String {
    let router = axum::Router::new().route("/api/collections/systems/records", get(systems));

    quoll::test::spawn(router).await
}

async fn systems(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if headers
        .get("authorization")
        .is_none_or(|key| key != "beszel-token")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    assert_eq!(
        (query["sort"].as_str(), query["fields"].as_str()),
        ("name", "id,name,status,info")
    );

    Json(json!({
        "page": 1,
        "perPage": 100,
        "totalItems": 2,
        "items": [
            {
                "id": "a1",
                "name": "nas",
                "status": "up",
                "info": { "u": 86_400.0, "cpu": 12.5, "mp": 40.0, "dp": 70.0, "dt": 51.0, "m": "Intel N100", "c": 4 },
            },
            { "id": "b2", "name": "pi", "status": "pending", "info": {} },
        ],
    }))
    .into_response()
}

#[tokio::test]
async fn reads_each_system_as_its_agent_last_reported_it() -> quoll::Result<()> {
    let url = beszel().await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: beszel-server-stats, column: 2, url: '{url}' }}\n"
    ));

    fixture.env("BESZEL_API_KEY=beszel-token\n");

    let server = fixture.serve().await;
    let key = server.key("beszel-server-stats").await;

    let data = server.api().widgets().data(&key).await?;

    assert_eq!(
        data,
        WidgetData::BeszelServerStats(BeszelServerStats {
            systems: vec![
                BeszelSystem {
                    id: "a1".to_owned(),
                    name: "nas".to_owned(),
                    status: "up".to_owned(),
                    up: true,
                    uptime: Some(86_400),
                    cpu: 12.5,
                    memory: 40.0,
                    disk: 70.0,
                    temperature: Some(51.0),
                    cpu_model: Some("Intel N100".to_owned()),
                },
                BeszelSystem {
                    id: "b2".to_owned(),
                    name: "pi".to_owned(),
                    status: "pending".to_owned(),
                    up: false,
                    uptime: None,
                    cpu: 0.0,
                    memory: 0.0,
                    disk: 0.0,
                    temperature: None,
                    cpu_model: None,
                },
            ],
        })
    );
    Ok(())
}
