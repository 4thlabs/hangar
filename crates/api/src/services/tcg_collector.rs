//! tcg-collector's parts: the cards the widget follows, and their prices.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of tcg-collector, in one call: each part asked is in the answer, the others are `null`. Both
/// cover the cards the widget follows, in the order `hangar.yml` lists them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct TcgCollectorRead {
    /// Each card, as the catalog has it, with its latest prices.
    pub cards: bool,
    /// The prices of each card over the widget's `days`.
    pub prices: bool,
}

/// tcg-collector's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TcgCollectorData {
    /// The cards, when the read asked.
    pub cards: Option<Vec<TcgFollowedCard>>,
    /// The prices of the cards, when the read asked.
    pub prices: Option<TcgPrices>,
}

/// A card tcg-collector follows: a version of it, by its Cardmarket ids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TcgFollowedCard {
    /// Cardmarket's game id: 1 for Magic, 21 for Star Wars Unlimited.
    pub game: u32,
    /// Cardmarket's product id, of this version of the card.
    pub product: u32,
    /// The id of its image, relayed by `GET /services/images/{widget}/{id}`.
    pub image_id: String,
    /// The card, `None` when tcg-collector does not know the product.
    pub card: Option<TcgCard>,
}

/// A product of a game's catalog, with its latest prices.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TcgCard {
    /// Its name.
    pub name: String,
    /// Its expansion.
    pub expansion: Option<String>,
    /// 1, 2... when its expansion has several products of its name, Cardmarket's V.1, V.2...
    pub version: Option<u32>,
    /// Its trend price.
    pub trend: Option<f64>,
    /// Its lowest price.
    pub low: Option<f64>,
    /// The trend price of its foil.
    pub trend_foil: Option<f64>,
}

/// The prices of the cards over the widget's `days`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TcgPrices {
    /// How many days the curves cover.
    pub days: u16,
    /// The curve of each card.
    pub cards: Vec<TcgCardPrices>,
}

/// The prices of a card over the widget's `days`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TcgCardPrices {
    /// Cardmarket's game id.
    pub game: u32,
    /// Cardmarket's product id.
    pub product: u32,
    /// Its prices, oldest first, from the first day that has one.
    pub history: Vec<TcgDailyPrices>,
}

/// A day of a card's prices. A day without a new price guide repeats the day before.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TcgDailyPrices {
    /// The day, `YYYY-MM-DD`.
    pub day: String,
    /// The trend price.
    pub trend: Option<f64>,
    /// The lowest price.
    pub low: Option<f64>,
}
