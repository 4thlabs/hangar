//! tcg-collector: the cards a widget follows, as its catalog has them, and their prices, and their images, relayed.

use std::sync::Arc;

use futures::future::{self, OptionFuture};
use hangar_api::{
    TcgCard, TcgCardPrices, TcgCollectorData, TcgCollectorRead, TcgDailyPrices, TcgFollowedCard,
    TcgPrices,
};
use hangar_core::FollowedCard;
use http::StatusCode;
use quoll::Bytes;
use serde::Deserialize;

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Image, Locator, Service};

quoll::api! {
    /// The API of tcg-collector's web server, under `/api`. It takes no key.
    #[server(none)]
    api TcgCollectorApi = "/api";

    group Catalog {
        GET "/card?game={game}&product={product}" => card(game: u32, product: u32) -> Listing;
        GET "/daily?game={game}&product={product}&days={days}" => daily(game: u32, product: u32, days: u16) -> Daily;
        GET "/image?game={game}&product={product}&size={size}" => image(game: u32, product: u32, size: &str) -> Bytes;
    }
}

/// The catalog's entry of a product: `null` for one it does not know.
#[derive(Debug, Deserialize)]
struct Listing {
    card: Option<Card>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Card {
    name: String,
    expansion: Option<String>,
    version: Option<u32>,
    trend: Option<f64>,
    low: Option<f64>,
    trend_foil: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Daily {
    days: Vec<Day>,
}

#[derive(Debug, Deserialize)]
struct Day {
    day: String,
    trend: Option<f64>,
    low: Option<f64>,
}

/// The size of the images: a row's is 40 px wide, and `small`, 146 px, stays sharp on a screen of 3×.
const IMAGE_SIZE: &str = "small";

/// The id of a card's image, `<game>-<product>`: a product id is unique within its game alone.
fn image_id(card: &FollowedCard) -> String {
    format!("{}-{}", card.game, card.product)
}

/// The card an image id names, `None` for an id the widget never gives: each part of one to nine digits, as
/// tcg-collector's API takes it.
fn parse_image_id(id: &str) -> Option<(u32, u32)> {
    let (game, product) = id.split_once('-')?;
    let is_id = |part: &str| {
        (1..=9).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_digit())
    };

    if !is_id(game) || !is_id(product) {
        return None;
    }

    Some((game.parse().ok()?, product.parse().ok()?))
}

/// tcg-collector, as the widgets read it: its clients, and its parts, each kept by its call, per card.
#[derive(Debug)]
pub(super) struct TcgCollector {
    clients: Arc<Clients<TcgCollectorApiClient>>,
    /// Each card's entry, by its game and its product.
    cards: Part<(u32, u32), Option<TcgCard>>,
    /// Each card's prices, by its game, its product and how many days.
    prices: Part<(u32, u32, u16), Vec<TcgDailyPrices>>,
}

impl TcgCollector {
    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            cards: Part::new("tcg-collector card"),
            prices: Part::new("tcg-collector prices"),
        }
    }

    /// The parts `read` asks of the tcg-collector `locator` finds, for `cards`, their prices over `days`.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        days: u16,
        cards: &[FollowedCard],
        read: TcgCollectorRead,
    ) -> Result<TcgCollectorData, Arc<LoadError>> {
        let TcgCollectorRead {
            cards: listed,
            prices,
        } = read;
        let (listed, prices) = tokio::join!(
            OptionFuture::from(listed.then(|| self.cards(locator, cards))),
            OptionFuture::from(prices.then(|| self.prices(locator, days, cards))),
        );

        Ok(TcgCollectorData {
            cards: listed.transpose()?,
            prices: prices.transpose()?,
        })
    }

    /// The image of the card `id` names, `None` for an id the widget never gives or a card with no image, which is
    /// common, and no failure.
    pub(super) async fn image(
        &self,
        locator: &Locator,
        id: &str,
    ) -> Result<Option<Bytes>, LoadError> {
        let Some((game, product)) = parse_image_id(id) else {
            return Ok(None);
        };
        let client = self.clients.of(locator).await?;

        match client.catalog().image(game, product, IMAGE_SIZE).await {
            Ok(image) => Ok(Some(image)),
            Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
            Err(error) => Err(LoadError::call("fetch an image of tcg-collector's")(error)),
        }
    }

    /// The client of the tcg-collector of `service`, which takes no key.
    fn client(service: &Service) -> Result<TcgCollectorApiClient, LoadError> {
        service.keyless_client::<TcgCollectorApi>("tcg-collector")
    }

    /// The catalog's entry of each of `cards`, in their order, all asked at once.
    async fn cards(
        &self,
        locator: &Locator,
        cards: &[FollowedCard],
    ) -> Result<Vec<TcgFollowedCard>, Arc<LoadError>> {
        future::try_join_all(cards.iter().map(|followed| async move {
            let (game, product) = (followed.game, followed.product);
            let name = image_id(followed);
            let card =
                self.cards
                    .get(
                        locator,
                        &self.clients,
                        (game, product),
                        move |client| async move {
                            let listing = client.catalog().card(game, product).await.map_err(
                                LoadError::call(format!("read the card {name} of tcg-collector")),
                            )?;

                            Ok(listing.card.map(|card| TcgCard {
                                name: card.name,
                                expansion: card.expansion,
                                version: card.version,
                                trend: card.trend,
                                low: card.low,
                                trend_foil: card.trend_foil,
                            }))
                        },
                    )
                    .await?;

            Ok::<_, Arc<LoadError>>(TcgFollowedCard {
                game,
                product,
                image_id: Image::TcgCard(image_id(followed)).to_string(),
                card,
            })
        }))
        .await
    }

    /// The prices over `days` of each of `cards`, in their order, all asked at once.
    async fn prices(
        &self,
        locator: &Locator,
        days: u16,
        cards: &[FollowedCard],
    ) -> Result<TcgPrices, Arc<LoadError>> {
        let curves = future::try_join_all(cards.iter().map(|followed| async move {
            let (game, product) = (followed.game, followed.product);
            let name = image_id(followed);
            let history = self
                .prices
                .get(
                    locator,
                    &self.clients,
                    (game, product, days),
                    move |client| async move {
                        let daily = client.catalog().daily(game, product, days).await.map_err(
                            LoadError::call(format!(
                                "read the prices of the card {name} of tcg-collector"
                            )),
                        )?;

                        Ok(daily
                            .days
                            .into_iter()
                            .map(|day| TcgDailyPrices {
                                day: day.day,
                                trend: day.trend,
                                low: day.low,
                            })
                            .collect())
                    },
                )
                .await?;

            Ok::<_, Arc<LoadError>>(TcgCardPrices {
                game,
                product,
                history,
            })
        }))
        .await?;

        Ok(TcgPrices {
            days,
            cards: curves,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::parse_image_id;

    #[test]
    fn reads_an_image_id_of_two_numbers_of_nine_digits_at_most() {
        assert_eq!(parse_image_id("21-755143"), Some((21, 755_143)));

        for id in ["21", "21-", "-1", "1-2-3", "1234567890-1", "a-1", "1.5-2"] {
            assert_eq!(parse_image_id(id), None, "{id}");
        }
    }
}
