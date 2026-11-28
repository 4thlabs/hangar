//! Finnhub's parts, each for every symbol of the widget, in the order `hangar.yml` lists them: a symbol a part cannot
//! give is left out of it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of Finnhub, in one call: each part asked is in the answer, the others are `null`. Each costs a
/// call per symbol, of the 60 a minute Finnhub's free plan gives, kept for the widget's `ttl`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct FinnhubRead {
    /// The quote of each symbol.
    pub quotes: bool,
    /// The company and the currency of each symbol.
    pub profiles: bool,
    /// The daily closes of each symbol over the last month.
    pub closes: bool,
}

/// Finnhub's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FinnhubData {
    /// The quotes, when the read asked: a symbol Finnhub cannot quote is left out.
    pub quotes: Option<Vec<FinnhubQuote>>,
    /// The profiles, when the read asked: a symbol Finnhub has no profile of is left out.
    pub profiles: Option<Vec<FinnhubProfile>>,
    /// The closes, when the read asked: none for a symbol Finnhub's plan gives none of.
    pub closes: Option<Vec<FinnhubCloses>>,
}

/// A symbol's quote, in the currency it is quoted in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FinnhubQuote {
    /// The symbol, as `hangar.yml` writes it.
    pub symbol: String,
    /// Its last price.
    pub price: f64,
    /// Its change since the previous close, in percent.
    pub change_percent: f64,
    /// The day's high.
    pub high: f64,
    /// The day's low.
    pub low: f64,
    /// The day's open.
    pub open: f64,
}

/// What Finnhub knows of a symbol's company.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct FinnhubProfile {
    /// The symbol, as `hangar.yml` writes it.
    pub symbol: String,
    /// The company's name, when Finnhub gives one.
    pub name: Option<String>,
    /// The ISO 4217 code of the currency it is quoted in, when Finnhub gives one.
    pub currency: Option<String>,
}

/// A symbol's daily closes over the last month.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct FinnhubCloses {
    /// The symbol, as `hangar.yml` writes it.
    pub symbol: String,
    /// Its closes, oldest first; none when Finnhub's plan gives none.
    pub closes: Vec<f64>,
}
