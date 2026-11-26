//! `stock-prices`, on a fake Finnhub.

use std::collections::HashMap;

use axum::Json;
use axum::extract::Query;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Widgets as _;
use hangar_api::{Stock, StockPrices, WidgetData};
use hangar_server::Settings;
use http::StatusCode;
use serde_json::{Value, json};

use super::{Fixture, Server};

/// A Finnhub on port 0 that answers its key alone. It quotes `AAPL`, with its profile and its closes, and `AIR.PA`,
/// with no profile and its closes refused, as on the free plan; it knows no `NOPE`. Its URL.
async fn finnhub() -> String {
    let router = axum::Router::new()
        .route("/api/v1/quote", get(quote))
        .route("/api/v1/stock/profile2", get(profile))
        .route("/api/v1/stock/candle", get(candles));

    quoll::test::spawn(router).await
}

fn refused(headers: &HeaderMap) -> bool {
    headers
        .get("x-finnhub-token")
        .is_none_or(|key| key != "finnhub-key")
}

async fn quote(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let quote = match query["symbol"].as_str() {
        "AAPL" => {
            json!({ "c": 190.5, "d": 2.0, "dp": 1.06, "h": 191.0, "l": 187.0, "o": 188.0, "pc": 188.5 })
        }
        "AIR.PA" => json!({ "c": 140.0, "dp": -0.5, "h": 141.0, "l": 139.0, "o": 140.5 }),
        _ => json!({ "c": 0, "d": null, "dp": null, "h": 0, "l": 0, "o": 0, "pc": 0 }),
    };

    Json(quote).into_response()
}

async fn profile(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let profile: Value = match query["symbol"].as_str() {
        "AAPL" => json!({ "name": "Apple Inc", "currency": "USD", "ticker": "AAPL" }),
        _ => json!({}),
    };

    Json(profile).into_response()
}

async fn candles(headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if refused(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let from: i64 = query["from"].parse().expect("a number");
    let to: i64 = query["to"].parse().expect("a number");

    assert_eq!(
        (query["resolution"].as_str(), to - from),
        ("D", 30 * 24 * 60 * 60)
    );

    match query["symbol"].as_str() {
        "AAPL" => {
            Json(json!({ "s": "ok", "c": [180.0, 185.0, 190.5], "t": [1, 2, 3] })).into_response()
        }
        _ => (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You don't have access to this resource." })),
        )
            .into_response(),
    }
}

/// The server of a store that places `tickers`, its Finnhub at `url`, with `variables` in its environment.
async fn serve(fixture: &Fixture, url: String, variables: &[(&str, &str)]) -> Server {
    fixture
        .serve_with(variables, |settings: &mut Settings| {
            settings.finnhub_api_url = url;
        })
        .await
}

#[tokio::test]
async fn quotes_each_symbol_in_its_order_and_leaves_out_one_finnhub_does_not_know()
-> quoll::Result<()> {
    let url = finnhub().await;
    let fixture =
        Fixture::new("  - { type: stock-prices, column: 3, tickers: [AIR.PA, NOPE, AAPL] }\n");
    let server = serve(&fixture, url, &[("FINNHUB_API_KEY", "finnhub-key")]).await;
    let key = server.key("stock-prices").await;

    let data = server.api().widgets().data(&key).await?;

    assert_eq!(
        data,
        WidgetData::StockPrices(StockPrices {
            stocks: vec![
                Stock {
                    symbol: "AIR.PA".to_owned(),
                    name: None,
                    currency: None,
                    price: 140.0,
                    change_percent: -0.5,
                    high: 141.0,
                    low: 139.0,
                    open: 140.5,
                    closes: vec![],
                },
                Stock {
                    symbol: "AAPL".to_owned(),
                    name: Some("Apple Inc".to_owned()),
                    currency: Some("USD".to_owned()),
                    price: 190.5,
                    change_percent: 1.06,
                    high: 191.0,
                    low: 187.0,
                    open: 188.0,
                    closes: vec![180.0, 185.0, 190.5],
                },
            ],
        })
    );
    Ok(())
}

#[tokio::test]
async fn fails_without_a_key_or_when_no_symbol_is_quoted() {
    let url = finnhub().await;
    let without_key = Fixture::new("  - { type: stock-prices, column: 3, tickers: [AAPL] }\n");
    let unknown = Fixture::new("  - { type: stock-prices, column: 3, tickers: [NOPE] }\n");

    for server in [
        serve(&without_key, url.clone(), &[]).await,
        serve(&unknown, url.clone(), &[("FINNHUB_API_KEY", "finnhub-key")]).await,
    ] {
        let key = server.key("stock-prices").await;

        assert_eq!(
            server.problem(&format!("/api/widgets/{key}")).await,
            (
                StatusCode::BAD_GATEWAY,
                Some("widgets.unavailable".to_owned())
            )
        );
    }
}
