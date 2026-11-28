//! tcg-collector's route, `tcg-collector-cards`'s service, on a fake tcg-collector, and the relay of its images.

use std::collections::HashMap;

use axum::Json;
use axum::extract::Query;
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use hangar_api::Services as _;
use hangar_api::{
    TcgCard, TcgCardPrices, TcgCollectorData, TcgCollectorRead, TcgDailyPrices, TcgFollowedCard,
    TcgPrices,
};
use http::StatusCode;
use serde_json::{Value, json};

use super::Fixture;

/// A tcg-collector on port 0 that knows the product 7 of the game 21 alone, and has its image; its URL.
async fn tcg_collector() -> String {
    let router = axum::Router::new()
        .route("/api/card", get(card))
        .route("/api/daily", get(daily))
        .route("/api/image", get(image));

    quoll::test::spawn(router).await
}

fn is_known(query: &HashMap<String, String>) -> bool {
    query["game"] == "21" && query["product"] == "7"
}

async fn card(Query(query): Query<HashMap<String, String>>) -> Json<Value> {
    if !is_known(&query) {
        return Json(json!({ "card": null }));
    }

    Json(json!({
        "card": {
            "product": "7",
            "name": "Luke Skywalker",
            "single": true,
            "expansionId": 1,
            "expansion": "Spark of Rebellion",
            "version": 2,
            "added": "2024-03-08",
            "trend": 12.5,
            "low": 9.9,
            "trendFoil": null,
        },
    }))
}

async fn daily(Query(query): Query<HashMap<String, String>>) -> Json<Value> {
    assert_eq!(query["days"], "14");

    if !is_known(&query) {
        return Json(json!({ "days": [] }));
    }

    Json(json!({
        "days": [
            { "day": "2026-11-24", "low": 9.5, "trend": 12.0, "avg1": null, "avg30": null, "low_foil": null, "trend_foil": null, "avg1_foil": null, "avg30_foil": null },
            { "day": "2026-11-25", "low": 9.9, "trend": null },
        ],
    }))
}

async fn image(Query(query): Query<HashMap<String, String>>) -> Response {
    assert_eq!(query["size"], "small");

    if is_known(&query) {
        return ([(CONTENT_TYPE, "image/jpeg")], "card bytes").into_response();
    }

    StatusCode::NOT_FOUND.into_response()
}

#[tokio::test]
async fn reads_each_card_in_its_order_with_its_prices_and_one_it_does_not_know() -> quoll::Result<()>
{
    let url = tcg_collector().await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: tcg-collector-cards, column: 2, url: '{url}', days: 14, cards: [{{ game: 21, product: 7 }}, \
         {{ game: 1, product: 99 }}] }}\n"
    ));
    let server = fixture.serve().await;
    let key = server.key("tcg-collector-cards").await;

    let read = |cards, prices| TcgCollectorRead { cards, prices };
    let data = server
        .api()
        .services()
        .tcg_collector(&key, read(true, true))
        .await?;

    assert_eq!(
        data,
        TcgCollectorData {
            cards: Some(vec![
                TcgFollowedCard {
                    game: 21,
                    product: 7,
                    image_id: "card.21-7".to_owned(),
                    card: Some(TcgCard {
                        name: "Luke Skywalker".to_owned(),
                        expansion: Some("Spark of Rebellion".to_owned()),
                        version: Some(2),
                        trend: Some(12.5),
                        low: Some(9.9),
                        trend_foil: None,
                    }),
                },
                TcgFollowedCard {
                    game: 1,
                    product: 99,
                    image_id: "card.1-99".to_owned(),
                    card: None,
                },
            ]),
            prices: Some(TcgPrices {
                days: 14,
                cards: vec![
                    TcgCardPrices {
                        game: 21,
                        product: 7,
                        history: vec![
                            TcgDailyPrices {
                                day: "2026-11-24".to_owned(),
                                trend: Some(12.0),
                                low: Some(9.5),
                            },
                            TcgDailyPrices {
                                day: "2026-11-25".to_owned(),
                                trend: None,
                                low: Some(9.9),
                            },
                        ],
                    },
                    TcgCardPrices {
                        game: 1,
                        product: 99,
                        history: vec![],
                    },
                ],
            }),
        }
    );
    assert_eq!(
        server
            .api()
            .services()
            .tcg_collector(&key, read(false, true))
            .await?
            .cards,
        None,
        "the cards, not asked, are not read"
    );

    let (status, headers, body) = server
        .get(&format!("/api/services/images/{key}/card.21-7"))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[CONTENT_TYPE], "image/jpeg");
    assert_eq!(body, b"card bytes");

    for id in ["card.1-99", "card.not-an-id", "card.1-2-3"] {
        assert_eq!(
            server
                .problem(&format!("/api/services/images/{key}/{id}"))
                .await
                .0,
            StatusCode::NOT_FOUND,
            "{id}"
        );
    }

    Ok(())
}
