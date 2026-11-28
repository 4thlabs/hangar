//! `stock-prices`: stock quotes from Finnhub's public API, each call kept per symbol, so that every placement shares
//! them and the 60 calls a minute of Finnhub's free plan go a long way.

use std::sync::Arc;
use std::time::Duration;

use futures::future;
use hangar_api::{Stock, StockPrices};
use jiff::Timestamp;
use quoll::client;
use serde::Deserialize;

use crate::Settings;
use crate::failure::Failure;
use crate::services::LoadError;
use crate::services::Service;
use crate::services::{Kept, Policy};

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

/// A quote of a symbol Finnhub knows, with its change.
#[derive(Debug, Clone)]
struct Quoted {
    price: f64,
    change_percent: f64,
    high: f64,
    low: f64,
    open: f64,
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

/// Finnhub, as the widgets call it, and what they read of it, kept per symbol.
#[derive(Debug, Clone)]
pub(super) struct Finnhub {
    /// `None` without a key, which Finnhub asks of every call.
    client: Option<FinnhubApiClient>,
    quotes: Arc<Kept<String, Quoted>>,
    profiles: Arc<Kept<String, Profile>>,
    closes: Arc<Kept<String, Vec<f64>>>,
}

impl Finnhub {
    /// A quote moves each second the market is open: this spares two placements asking twice, no more.
    const QUOTE_POLICY: Policy = Policy {
        fresh: Duration::from_secs(30),
        stale: Duration::ZERO,
    };

    /// A company's name and currency hardly change: served a day, and a week more while Finnhub fails.
    const PROFILE_POLICY: Policy = Policy {
        fresh: Duration::from_secs(24 * 60 * 60),
        stale: Duration::from_secs(7 * 24 * 60 * 60),
    };

    /// The closes gain one a day: an hour keeps the curve current without a call per visit.
    const CLOSES_POLICY: Policy = Policy {
        fresh: Duration::from_secs(60 * 60),
        stale: Duration::from_secs(24 * 60 * 60),
    };

    /// The period the curve covers.
    const CLOSES_PERIOD: Duration = Duration::from_secs(30 * 24 * 60 * 60);

    /// Finnhub at the URL of `settings`, with their key.
    ///
    /// # Panics
    ///
    /// When its client cannot be built, as when the system's TLS settings do not load.
    pub(super) fn new(settings: &Settings) -> Self {
        let client = settings.finnhub_api_key.as_ref().map(|key| {
            Service::builder()
                .with(client::key::<Token>(key.expose()))
                .build::<FinnhubApi>(&settings.finnhub_api_url)
                .expect("the client of Finnhub builds")
        });

        Self {
            client,
            quotes: Kept::new("Finnhub quote"),
            profiles: Kept::new("Finnhub profile"),
            closes: Kept::new("Finnhub closes"),
        }
    }

    /// The stock of each of `symbols`, in their order. A symbol Finnhub cannot quote is logged and left out, so that one
    /// bad entry does not take the card down; when none can be quoted, the card fails.
    pub(super) async fn stocks(&self, symbols: &[String]) -> Result<StockPrices, LoadError> {
        let Some(client) = &self.client else {
            return Err(LoadError::refused(
                "FINNHUB_API_KEY is not set: the stocks card needs a Finnhub API key",
            ));
        };
        let calls = Calls {
            finnhub: self,
            client,
        };
        let stocks = future::join_all(symbols.iter().map(|symbol| calls.stock(symbol))).await;
        let mut quoted = Vec::new();
        let mut last_failure = None;

        for (symbol, stock) in symbols.iter().zip(stocks) {
            match stock {
                Ok(stock) => quoted.push(stock),
                Err(error) => {
                    tracing::warn!(
                        symbol,
                        error = %Failure::chain(&*error),
                        "leaving a symbol out of the stocks card"
                    );
                    last_failure = Some(error);
                }
            }
        }

        match last_failure {
            Some(error) if quoted.is_empty() => Err(LoadError::refused(format!(
                "Finnhub quoted none of the symbols: {}",
                Failure::chain(&*error)
            ))),
            _ => Ok(StockPrices { stocks: quoted }),
        }
    }
}

/// The calls of one load of the card.
struct Calls<'a> {
    finnhub: &'a Finnhub,
    client: &'a FinnhubApiClient,
}

impl Calls<'_> {
    /// The stock of `symbol`: its quote, its profile and its closes, asked at once. The quote alone is needed: without
    /// its profile, the stock shows with no name and a bare price, and asks for it again at the next load.
    async fn stock(&self, symbol: &str) -> Result<Stock, Arc<LoadError>> {
        let (quote, profile, closes) = tokio::join!(
            self.quote(symbol),
            self.profile(symbol),
            self.closes(symbol)
        );
        let quote = quote?;
        let profile = profile.unwrap_or_else(|error| {
            tracing::warn!(symbol, error = %Failure::chain(&*error), "showing a stock without its profile");

            Arc::new(Profile::default())
        });
        Ok(Stock {
            symbol: symbol.to_owned(),
            name: Self::given(profile.name.as_deref()),
            currency: Self::given(profile.currency.as_deref()),
            price: quote.price,
            change_percent: quote.change_percent,
            high: quote.high,
            low: quote.low,
            open: quote.open,
            closes: (*closes).clone(),
        })
    }

    /// A field of a profile, `None` when Finnhub leaves it empty: a currency of `""` is none.
    fn given(field: Option<&str>) -> Option<String> {
        field
            .filter(|field| !field.trim().is_empty())
            .map(str::to_owned)
    }

    /// The quote of `symbol`, kept, refused for a symbol Finnhub does not know rather than shown at 0.
    async fn quote(&self, symbol: &str) -> Result<Arc<Quoted>, Arc<LoadError>> {
        let (client, owned) = (self.client.clone(), symbol.to_owned());

        self.finnhub
            .quotes
            .get(
                symbol.to_owned(),
                Finnhub::QUOTE_POLICY,
                move || async move {
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

                    Ok(Quoted {
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

    /// The profile of `symbol`, kept.
    async fn profile(&self, symbol: &str) -> Result<Arc<Profile>, Arc<LoadError>> {
        let (client, owned) = (self.client.clone(), symbol.to_owned());

        self.finnhub
            .profiles
            .get(
                symbol.to_owned(),
                Finnhub::PROFILE_POLICY,
                move || async move {
                    client
                        .quotes()
                        .profile(&owned)
                        .await
                        .map_err(LoadError::call(format!(
                            "read the profile of {owned} on Finnhub"
                        )))
                },
            )
            .await
    }

    /// The daily closes of `symbol` over the last month, kept. The free plan refuses them: the card then shows no
    /// curve, but the quote still, and the refusal is logged and kept as long as a curve would be.
    async fn closes(&self, symbol: &str) -> Arc<Vec<f64>> {
        let (client, owned) = (self.client.clone(), symbol.to_owned());
        let kept = self
            .finnhub
            .closes
            .get(
                symbol.to_owned(),
                Finnhub::CLOSES_POLICY,
                move || async move {
                    let to = Timestamp::now().as_second();
                    let from = to - Finnhub::CLOSES_PERIOD.as_secs() as i64;
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
