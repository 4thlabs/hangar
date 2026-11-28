//! Finnhub's public API: each symbol's quote, profile and closes, each kept per symbol, so that every placement shares
//! them. Finnhub's free plan gives 60 calls a minute: each symbol's calls are made again once a `ttl` passes, 30 minutes
//! by default, and a longer one asks less often.

use std::sync::Arc;
use std::time::Duration;

use futures::future::{self, OptionFuture};
use hangar_api::{FinnhubCloses, FinnhubData, FinnhubProfile, FinnhubQuote, FinnhubRead};
use jiff::Timestamp;
use quoll::client;
use serde::Deserialize;

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Locator, Service};
use crate::failure::Failure;

quoll::api! {
    /// Finnhub's API, under `/api/v1`.
    #[server(none)]
    api FinnhubApi = "/api/v1";

    /// A Finnhub API key.
    scheme Token = header "X-Finnhub-Token";

    #[auth(Token)]
    group Quotes {
        /// A symbol Finnhub does not know is quoted at zeros, its changes `null`, rather than refused.
        GET "/quote?symbol={symbol}" => quote(symbol: &str) -> Quote;
        /// One object, empty for a symbol of no profile.
        GET "/stock/profile2?symbol={symbol}" => profile(symbol: &str) -> Profile;
        GET "/stock/candle?symbol={symbol}&resolution={resolution}&from={from}&to={to}"
            => candles(symbol: &str, resolution: &str, from: i64, to: i64) -> Candles;
    }
}

/// A quote, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct Quote {
    /// The last price.
    c: f64,
    /// The change since the previous close, in percent; `null` for a symbol Finnhub does not know.
    dp: Option<f64>,
    /// The day's high.
    h: f64,
    /// The day's low.
    l: f64,
    /// The day's open.
    o: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct Profile {
    name: Option<String>,
    currency: Option<String>,
}

/// The daily candles: `s` is `no_data` for a range with no day of trading.
#[derive(Debug, Deserialize)]
struct Candles {
    s: String,
    #[serde(default)]
    c: Vec<f64>,
}

/// Finnhub, as the widgets read it: its client, and each symbol's parts, kept by symbol.
#[derive(Debug)]
pub(super) struct Finnhub {
    clients: Arc<Clients<FinnhubApiClient>>,
    quotes: Part<String, FinnhubQuote>,
    profiles: Part<String, FinnhubProfile>,
    closes: Part<String, Vec<f64>>,
}

impl Finnhub {
    /// The period the curve covers.
    const CLOSES_PERIOD: Duration = Duration::from_secs(30 * 24 * 60 * 60);

    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            quotes: Part::new("Finnhub quote"),
            profiles: Part::new("Finnhub profile"),
            closes: Part::new("Finnhub closes"),
        }
    }

    /// The parts `read` asks of Finnhub, for `symbols`.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        symbols: &[String],
        read: FinnhubRead,
    ) -> Result<FinnhubData, Arc<LoadError>> {
        let FinnhubRead {
            quotes,
            profiles,
            closes,
        } = read;
        let (quotes, profiles, closes) = tokio::join!(
            OptionFuture::from(quotes.then(|| self.quotes(locator, symbols))),
            OptionFuture::from(profiles.then(|| self.profiles(locator, symbols))),
            OptionFuture::from(closes.then(|| self.closes(locator, symbols))),
        );

        Ok(FinnhubData {
            quotes: quotes.transpose()?,
            profiles,
            closes,
        })
    }

    /// The client of Finnhub at the address of `service`, with its key, which Finnhub asks of every call.
    fn client(service: &Service) -> Result<FinnhubApiClient, LoadError> {
        let Some(key) = service.key() else {
            return Err(LoadError::refused(
                "FINNHUB_API_KEY is not set: the stocks card needs a Finnhub API key",
            ));
        };

        service.client::<FinnhubApi>("Finnhub", Some(client::key::<Token>(key)))
    }

    /// The quote of each of `symbols`, in their order. A symbol Finnhub cannot quote is logged and left out, so that
    /// one bad entry does not take the card down; when none can be quoted, the part fails.
    async fn quotes(
        &self,
        locator: &Locator,
        symbols: &[String],
    ) -> Result<Vec<FinnhubQuote>, Arc<LoadError>> {
        let quotes =
            future::join_all(symbols.iter().map(|symbol| self.quote(locator, symbol))).await;
        let mut quoted = Vec::new();
        let mut last_failure = None;

        for (symbol, quote) in symbols.iter().zip(quotes) {
            match quote {
                Ok(quote) => quoted.push(quote),
                Err(error) => {
                    tracing::warn!(
                        symbol,
                        error = %Failure::chain(&*error),
                        "leaving a symbol out of Finnhub's quotes"
                    );
                    last_failure = Some(error);
                }
            }
        }

        match last_failure {
            Some(error) if quoted.is_empty() => Err(Arc::new(LoadError::refused(format!(
                "Finnhub quoted none of the symbols: {}",
                Failure::chain(&*error)
            )))),
            _ => Ok(quoted),
        }
    }

    /// The quote of `symbol`, refused for a symbol Finnhub does not know rather than given at 0.
    async fn quote(&self, locator: &Locator, symbol: &str) -> Result<FinnhubQuote, Arc<LoadError>> {
        let owned = symbol.to_owned();

        self.quotes
            .get(
                locator,
                &self.clients,
                owned.clone(),
                move |client| async move {
                    let quote = client
                        .quotes()
                        .quote(&owned)
                        .await
                        .map_err(LoadError::call(format!("quote {owned} on Finnhub")))?;
                    let Some(change_percent) = quote.dp else {
                        return Err(LoadError::refused(format!(
                            "Finnhub knows no symbol {owned}"
                        )));
                    };

                    Ok(FinnhubQuote {
                        symbol: owned,
                        price: quote.c,
                        change_percent,
                        high: quote.h,
                        low: quote.l,
                        open: quote.o,
                    })
                },
            )
            .await
    }

    /// The profile of each of `symbols`, in their order. One Finnhub has none of, or that fails, is logged and left out:
    /// its stock shows with no name and a bare price.
    async fn profiles(&self, locator: &Locator, symbols: &[String]) -> Vec<FinnhubProfile> {
        let profiles =
            future::join_all(symbols.iter().map(|symbol| self.profile(locator, symbol))).await;

        symbols
            .iter()
            .zip(profiles)
            .filter_map(|(symbol, profile)| match profile {
                Ok(profile) => Some(profile),
                Err(error) => {
                    tracing::warn!(
                        symbol,
                        error = %Failure::chain(&*error),
                        "leaving a symbol out of Finnhub's profiles"
                    );

                    None
                }
            })
            .collect()
    }

    /// The profile of `symbol`, a field Finnhub leaves empty as `None`.
    async fn profile(
        &self,
        locator: &Locator,
        symbol: &str,
    ) -> Result<FinnhubProfile, Arc<LoadError>> {
        let owned = symbol.to_owned();

        self.profiles
            .get(
                locator,
                &self.clients,
                owned.clone(),
                move |client| async move {
                    let profile =
                        client
                            .quotes()
                            .profile(&owned)
                            .await
                            .map_err(LoadError::call(format!(
                                "read the profile of {owned} on Finnhub"
                            )))?;

                    Ok(FinnhubProfile {
                        name: Self::given(profile.name),
                        currency: Self::given(profile.currency),
                        symbol: owned,
                    })
                },
            )
            .await
    }

    /// A field of a profile, `None` when Finnhub leaves it empty: a currency of `""` is none.
    fn given(field: Option<String>) -> Option<String> {
        field.filter(|field| !field.trim().is_empty())
    }

    /// The daily closes of each of `symbols` over the last month, in their order.
    async fn closes(&self, locator: &Locator, symbols: &[String]) -> Vec<FinnhubCloses> {
        let closes =
            future::join_all(symbols.iter().map(|symbol| self.closes_of(locator, symbol))).await;

        symbols
            .iter()
            .zip(closes)
            .map(|(symbol, closes)| FinnhubCloses {
                symbol: symbol.clone(),
                closes,
            })
            .collect()
    }

    /// The daily closes of `symbol` over the last month. The free plan refuses them: the card then shows no curve, but
    /// the quote still, and the refusal is logged and kept as a curve would be.
    async fn closes_of(&self, locator: &Locator, symbol: &str) -> Vec<f64> {
        let owned = symbol.to_owned();
        let kept = self
            .closes
            .get(
                locator,
                &self.clients,
                owned.clone(),
                move |client| async move {
                    let to = Timestamp::now().as_second();
                    let from = to - Self::CLOSES_PERIOD.as_secs() as i64;
                    let candles = client.quotes().candles(&owned, "D", from, to).await;

                    match candles {
                        Ok(candles) if candles.s == "ok" => Ok(candles.c),
                        Ok(_) => Ok(Vec::new()),
                        Err(error) => {
                            tracing::warn!(
                                symbol = owned,
                                error = %Failure::chain(&error),
                                "showing a stock without its curve"
                            );

                            Ok(Vec::new())
                        }
                    }
                },
            )
            .await;

        kept.unwrap_or_default()
    }
}
