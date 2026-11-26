//! `tcg-collector-cards`: the prices of the cards tcg-collector follows, and their images, relayed.

use futures::future;
use hangar_api::{TcgCard, TcgCollectorCards, TcgDailyPrices, TcgFollowedCard};
use hangar_core::FollowedCard;
use http::StatusCode;
use quoll::Bytes;
use serde::Deserialize;

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// The API of tcg-collector's web server, under `/api`. It takes no key.
    #[server(none)]
    api TcgCollectorApi = "/api";

    group TcgCollector {
        GET "/card?game={game}&product={product}" => card(game: u32, product: u32) -> Catalog;
        GET "/daily?game={game}&product={product}&days={days}" => daily(game: u32, product: u32, days: u16) -> Daily;
        GET "/image?game={game}&product={product}&size={size}" => image(game: u32, product: u32, size: &str) -> Bytes;
    }
}

/// The catalog's entry of a product: `null` for one it does not know.
#[derive(Debug, Deserialize)]
struct Catalog {
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

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(TcgCollectorApiClient);

impl Client {
    /// The client of the service `service`, with its key.
    ///
    /// # Errors
    ///
    /// When the client cannot be built, or the key cannot be sent.
    pub(super) fn new(service: &Service) -> Result<Self, LoadError> {
        build(service).map(Self)
    }
}

/// The client of the tcg-collector of `service`, which takes no key.
fn build(service: &Service) -> Result<TcgCollectorApiClient, LoadError> {
    service.keyless_client::<TcgCollectorApi>("tcg-collector")
}

/// The catalog's entry and the prices over `days` of each card of `cards`, from the tcg-collector of `client`, all
/// asked at once.
pub(super) async fn load(
    client: &Client,
    days: u16,
    cards: &[FollowedCard],
) -> Result<TcgCollectorCards, LoadError> {
    let tcg_collector = client.0.tcg_collector();
    let followed = future::try_join_all(cards.iter().map(|followed| async {
        let (catalog, daily) = tokio::join!(
            tcg_collector.card(followed.game, followed.product),
            tcg_collector.daily(followed.game, followed.product, days)
        );
        let catalog = catalog.map_err(LoadError::call(format!(
            "read the card {} of tcg-collector",
            image_id(followed)
        )))?;
        let daily = daily.map_err(LoadError::call(format!(
            "read the prices of the card {} of tcg-collector",
            image_id(followed)
        )))?;

        Ok::<_, LoadError>(TcgFollowedCard {
            game: followed.game,
            product: followed.product,
            image_id: image_id(followed),
            card: catalog.card.map(|card| TcgCard {
                name: card.name,
                expansion: card.expansion,
                version: card.version,
                trend: card.trend,
                low: card.low,
                trend_foil: card.trend_foil,
            }),
            history: daily
                .days
                .into_iter()
                .map(|day| TcgDailyPrices {
                    day: day.day,
                    trend: day.trend,
                    low: day.low,
                })
                .collect(),
        })
    }))
    .await?;

    Ok(TcgCollectorCards {
        days,
        cards: followed,
    })
}

/// The image of the card `id` names, `None` for an id the widget never gives or a card with no image, which is
/// common, and no failure.
pub(super) async fn image(client: &Client, id: &str) -> Result<Option<Bytes>, LoadError> {
    let Some((game, product)) = parse_image_id(id) else {
        return Ok(None);
    };

    match client
        .0
        .tcg_collector()
        .image(game, product, IMAGE_SIZE)
        .await
    {
        Ok(image) => Ok(Some(image)),
        Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
        Err(error) => Err(LoadError::call("fetch an image of tcg-collector's")(error)),
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
