//! `gluetun-vpn-status`, on a fake gluetun.

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Widgets as _;
use hangar_api::{GluetunVpnStatus, WidgetData};
use http::StatusCode;
use serde_json::{Value, json};

use super::Fixture;

/// A gluetun on port 0 whose control server answers `public_ip` to its key alone; its URL.
async fn gluetun(public_ip: Value) -> String {
    let router = axum::Router::new()
        .route("/v1/publicip/ip", get(answer))
        .with_state(public_ip);

    quoll::test::spawn(router).await
}

async fn answer(State(public_ip): State<Value>, headers: HeaderMap) -> Response {
    if headers
        .get("x-api-key")
        .is_none_or(|key| key != "gluetun-key")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    Json(public_ip).into_response()
}

/// What the widget loads from a gluetun that answers `public_ip`.
async fn status(public_ip: Value) -> quoll::Result<WidgetData> {
    let url = gluetun(public_ip).await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: gluetun-vpn-status, column: 1, url: '{url}' }}\n"
    ));

    fixture.env("GLUETUN_API_KEY=gluetun-key\n");

    let server = fixture.serve().await;
    let key = server.key("gluetun-vpn-status").await;

    server.api().widgets().data(&key).await
}

#[tokio::test]
async fn reads_where_the_tunnel_exits() -> quoll::Result<()> {
    let data = status(json!({
        "public_ip": "203.0.113.7",
        "city": "Amsterdam",
        "country": "Netherlands",
        "organization": "Example VPN",
    }))
    .await?;

    assert_eq!(
        data,
        WidgetData::GluetunVpnStatus(GluetunVpnStatus {
            public_ip: "203.0.113.7".to_owned(),
            city: "Amsterdam".to_owned(),
            country: "Netherlands".to_owned(),
        })
    );
    Ok(())
}

#[tokio::test]
async fn reads_a_field_left_out_or_of_another_kind_as_empty() -> quoll::Result<()> {
    let empty = WidgetData::GluetunVpnStatus(GluetunVpnStatus {
        public_ip: String::new(),
        city: String::new(),
        country: String::new(),
    });

    assert_eq!(status(json!(null)).await?, empty);
    assert_eq!(
        status(json!({ "public_ip": 42, "city": null })).await?,
        empty
    );
    Ok(())
}
