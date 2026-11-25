//! The `widgets:` of `hangar.yml`: the dashboard, in declaration order, each widget with its column and its options,
//! checked as the descriptors of the Waku version's widgets check them.

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde::de::{self, DeserializeOwned, Deserializer};
use serde_norway::Value;

use super::ConfigError;
use super::rules::{Integer, List, MAX_SAFE_INTEGER, Matching, NonEmpty, Pattern, present};

/// A widget placed on the dashboard.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Widget {
    /// The column it is placed in.
    pub column: Column,
    /// Which widget it is, with its options.
    pub kind: WidgetKind,
}

/// One of the three columns of the dashboard, `1`, `2` or `3` in `hangar.yml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Column {
    /// `1`, on the left.
    First,
    /// `2`, in the middle.
    Second,
    /// `3`, on the right.
    Third,
}

/// Which widget a declaration places, its `type`, with the options it takes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum WidgetKind {
    /// `clock`.
    Clock,
    /// `docker-general-stats`.
    DockerGeneralStats,
    /// `arcane-general-stats`.
    ArcaneGeneralStats {
        /// Where Arcane is.
        service: ServiceOptions,
    },
    /// `backrest-summary`.
    BackrestSummary {
        /// Where Backrest is.
        service: ServiceOptions,
    },
    /// `beszel-server-stats`.
    BeszelServerStats {
        /// Where Beszel is.
        service: ServiceOptions,
    },
    /// `forgejo-ci`.
    ForgejoCi {
        /// Where Forgejo is.
        service: ServiceOptions,
        /// The users and organizations whose repositories the card covers; `None`, every repository the key sees.
        owners: Option<Vec<String>>,
    },
    /// `frigate-events`.
    FrigateEvents {
        /// Where Frigate is.
        service: ServiceOptions,
    },
    /// `gluetun-vpn-status`.
    GluetunVpnStatus {
        /// Where Gluetun is.
        service: ServiceOptions,
    },
    /// `miniflux-entries`.
    MinifluxEntries {
        /// Where Miniflux is.
        service: ServiceOptions,
    },
    /// `jellyfin-latest`.
    JellyfinLatest {
        /// Where Jellyfin is.
        service: ServiceOptions,
        /// The user whose latest items are shown: Jellyfin has no server-wide answer.
        user: String,
    },
    /// `tcg-collector-cards`.
    TcgCollectorCards {
        /// Where tcg-collector is.
        service: ServiceOptions,
        /// How many days the price curves cover, 30 unless the declaration says.
        days: u16,
        /// The cards followed, from 1 to 20.
        cards: Vec<FollowedCard>,
    },
    /// `github-releases`, which reads GitHub's public API rather than a store app.
    GithubReleases {
        /// How long the card stays fresh; `None`, the widget's default.
        ttl: Option<Duration>,
        /// The repositories, `owner/repo`.
        repositories: Vec<String>,
    },
    /// `stock-prices`, which reads Finnhub's public API rather than a store app.
    StockPrices {
        /// How long the card stays fresh; `None`, the widget's default.
        ttl: Option<Duration>,
        /// The symbols, from 1 to 10, each once.
        tickers: Vec<String>,
    },
}

/// Where a widget's service is, and how fresh its card stays.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct ServiceOptions {
    /// The address Hangar calls the service at; `None`, the link.
    pub url: Option<String>,
    /// The address the browser opens; `None`, `https://<container>.<DOMAIN>`.
    pub link: Option<String>,
    /// How long the card stays fresh; `None`, the widget's default.
    pub ttl: Option<Duration>,
}

/// One version of a card that tcg-collector follows, by its Cardmarket ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub struct FollowedCard {
    /// Cardmarket's game id: 1 for Magic, 21 for Star Wars Unlimited.
    pub game: u32,
    /// Cardmarket's product id, of this version of the card.
    pub product: u32,
}

impl Column {
    /// The column's number in `hangar.yml`, from 1.
    pub fn number(self) -> u8 {
        match self {
            Self::First => 1,
            Self::Second => 2,
            Self::Third => 3,
        }
    }
}

impl Widget {
    /// Every `type` a declaration may have, in the order of the Waku version's descriptors.
    pub(super) const TYPES: [&str; 13] = [
        "clock",
        "docker-general-stats",
        "arcane-general-stats",
        "backrest-summary",
        "beszel-server-stats",
        "forgejo-ci",
        "frigate-events",
        "gluetun-vpn-status",
        "miniflux-entries",
        "jellyfin-latest",
        "tcg-collector-cards",
        "github-releases",
        "stock-prices",
    ];

    /// The dashboard of a store whose `hangar.yml` declares no `widgets:`: a clock and Docker's stats in the first
    /// column, Frigate's events in the third.
    pub(super) fn defaults() -> Vec<Self> {
        vec![
            Self {
                column: Column::First,
                kind: WidgetKind::Clock,
            },
            Self {
                column: Column::First,
                kind: WidgetKind::DockerGeneralStats,
            },
            Self {
                column: Column::Third,
                kind: WidgetKind::FrigateEvents {
                    service: ServiceOptions::default(),
                },
            },
        ]
    }

    /// The declaration at `index` of `widgets:`. Its `type` says which fields it has, so the declaration is read in
    /// two steps, and its errors name their field under `widgets[<index>]` all the same.
    pub(super) fn parse(index: usize, declaration: &Value) -> Result<Self, ConfigError> {
        let parser = Declaration { index, declaration };

        if !declaration.is_mapping() {
            return Err(parser.invalid("", "expected a mapping"));
        }

        let Some(Value::String(widget_type)) = declaration.get("type") else {
            return Err(parser.invalid(".type", "expected a widget type"));
        };
        let kind = parser.kind(widget_type)?;
        let placement: Placement = parser.fields()?;

        Ok(Self {
            column: placement.column(),
            kind,
        })
    }
}

/// A declaration of `widgets:`, read into the fields of its type.
struct Declaration<'a> {
    index: usize,
    declaration: &'a Value,
}

impl Declaration<'_> {
    /// The widget of type `widget_type`, with its options.
    fn kind(&self, widget_type: &str) -> Result<WidgetKind, ConfigError> {
        let kind = match widget_type {
            "clock" => WidgetKind::Clock,
            "docker-general-stats" => WidgetKind::DockerGeneralStats,
            "arcane-general-stats" => WidgetKind::ArcaneGeneralStats {
                service: self.service()?,
            },
            "backrest-summary" => WidgetKind::BackrestSummary {
                service: self.service()?,
            },
            "beszel-server-stats" => WidgetKind::BeszelServerStats {
                service: self.service()?,
            },
            "forgejo-ci" => {
                let service = self.service()?;
                let ForgejoFields { owners } = self.fields()?;

                WidgetKind::ForgejoCi {
                    service,
                    owners: owners.map(|owners| Self::strings(owners.0)),
                }
            }
            "frigate-events" => WidgetKind::FrigateEvents {
                service: self.service()?,
            },
            "gluetun-vpn-status" => WidgetKind::GluetunVpnStatus {
                service: self.service()?,
            },
            "miniflux-entries" => WidgetKind::MinifluxEntries {
                service: self.service()?,
            },
            "jellyfin-latest" => {
                let service = self.service()?;
                let JellyfinFields { user } = self.fields()?;

                WidgetKind::JellyfinLatest {
                    service,
                    user: user.0,
                }
            }
            "tcg-collector-cards" => self.tcg_collector_cards()?,
            "github-releases" => {
                let Freshness { ttl } = self.fields()?;
                let GithubFields { repositories } = self.fields()?;

                WidgetKind::GithubReleases {
                    ttl: Freshness::duration(ttl),
                    repositories: Self::strings(repositories.0),
                }
            }
            "stock-prices" => self.stock_prices()?,
            unknown => {
                let message = format!(
                    "unknown widget type `{unknown}`, expected one of: {}",
                    Widget::TYPES.join(", ")
                );

                return Err(self.invalid(".type", message));
            }
        };

        Ok(kind)
    }

    /// A `tcg-collector-cards` widget.
    fn tcg_collector_cards(&self) -> Result<WidgetKind, ConfigError> {
        let service = self.service()?;
        let TcgCollectorFields { days, cards } = self.fields()?;
        let days = u16::try_from(days.0).expect("the days are bounded to 3650");
        let cards = cards
            .0
            .into_iter()
            .map(|card| FollowedCard {
                game: card.game.id(),
                product: card.product.id(),
            })
            .collect();

        Ok(WidgetKind::TcgCollectorCards {
            service,
            days,
            cards,
        })
    }

    /// A `stock-prices` widget, whose symbols are each listed once.
    fn stock_prices(&self) -> Result<WidgetKind, ConfigError> {
        let Freshness { ttl } = self.fields()?;
        let StockFields { tickers } = self.fields()?;
        let tickers = Self::strings(tickers.0);
        let is_repeated = tickers
            .iter()
            .enumerate()
            .any(|(index, ticker)| tickers[..index].contains(ticker));

        if is_repeated {
            return Err(self.invalid(".tickers", "ticker symbols must be unique"));
        }

        Ok(WidgetKind::StockPrices {
            ttl: Freshness::duration(ttl),
            tickers,
        })
    }

    /// The service options, `url`, `link` and `ttl`.
    fn service(&self) -> Result<ServiceOptions, ConfigError> {
        let ServiceFields { url, link, ttl } = self.fields()?;

        Ok(ServiceOptions {
            url: url.map(|url| url.0),
            link: link.map(|link| link.0),
            ttl: Freshness::duration(ttl),
        })
    }

    /// The fields of the declaration that `T` reads; it ignores the others.
    fn fields<T: DeserializeOwned>(&self) -> Result<T, ConfigError> {
        serde_path_to_error::deserialize(self.declaration.clone())
            .map_err(|error| ConfigError::deserializing(&self.at(""), &error))
    }

    /// An error on the field at `path` under the declaration, `.type` say.
    fn invalid(&self, path: &str, message: impl Into<String>) -> ConfigError {
        ConfigError::invalid(self.at(path), message)
    }

    /// The path of `path` under the declaration.
    fn at(&self, path: &str) -> String {
        format!("widgets[{}]{path}", self.index)
    }

    /// The strings that matched a pattern.
    fn strings<P>(matched: Vec<Matching<P>>) -> Vec<String> {
        matched.into_iter().map(|matching| matching.0).collect()
    }
}

/// Where a widget is placed.
#[derive(Deserialize)]
struct Placement {
    column: Integer<1, 3>,
}

impl Placement {
    fn column(&self) -> Column {
        match self.column.0 {
            1 => Column::First,
            2 => Column::Second,
            _ => Column::Third,
        }
    }
}

/// How fresh a card stays, in seconds.
#[derive(Deserialize)]
struct Freshness {
    #[serde(default, deserialize_with = "present")]
    ttl: Option<Integer<1, MAX_SAFE_INTEGER>>,
}

impl Freshness {
    fn duration(ttl: Option<Integer<1, MAX_SAFE_INTEGER>>) -> Option<Duration> {
        ttl.map(|ttl| Duration::from_secs(ttl.unsigned()))
    }
}

/// The fields of a widget that reads a service.
#[derive(Deserialize)]
struct ServiceFields {
    #[serde(default, deserialize_with = "present")]
    url: Option<ServiceUrl>,
    #[serde(default, deserialize_with = "present")]
    link: Option<ServiceUrl>,
    #[serde(default, deserialize_with = "present")]
    ttl: Option<Integer<1, MAX_SAFE_INTEGER>>,
}

/// The fields of `forgejo-ci` beside its service.
#[derive(Deserialize)]
struct ForgejoFields {
    #[serde(default, deserialize_with = "present")]
    owners: Option<List<Matching<OwnerName>, 1>>,
}

/// The fields of `jellyfin-latest` beside its service.
#[derive(Deserialize)]
struct JellyfinFields {
    user: NonEmpty,
}

/// The fields of `tcg-collector-cards` beside its service.
#[derive(Deserialize)]
struct TcgCollectorFields {
    #[serde(default = "TcgCollectorFields::default_days")]
    days: Integer<1, 3650>,
    cards: List<CardIds, 1, 20>,
}

impl TcgCollectorFields {
    /// How many days the price curves cover when the declaration does not say.
    fn default_days() -> Integer<1, 3650> {
        Integer(30)
    }
}

/// A card by its Cardmarket ids.
#[derive(Deserialize)]
struct CardIds {
    game: CardmarketId,
    product: CardmarketId,
}

/// A Cardmarket id as tcg-collector's API accepts one: a whole number of at most nine digits.
#[derive(Deserialize)]
struct CardmarketId(Integer<0, 999_999_999>);

impl CardmarketId {
    fn id(&self) -> u32 {
        u32::try_from(self.0.0).expect("the ids are bounded to nine digits")
    }
}

/// The fields of `github-releases` beside its freshness.
#[derive(Deserialize)]
struct GithubFields {
    repositories: List<Matching<RepositoryName>, 1>,
}

/// The fields of `stock-prices` beside its freshness.
#[derive(Deserialize)]
struct StockFields {
    tickers: List<Matching<TickerSymbol>, 1, 10>,
}

/// A user or organization of Forgejo.
#[derive(Debug, Clone)]
struct OwnerName;

impl Pattern for OwnerName {
    const MESSAGE: &str = "must be a user or organization name";

    fn regex() -> &'static Regex {
        static OWNER: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.-]+$").expect("the pattern is valid"));

        &OWNER
    }
}

/// A GitHub repository, `owner/repo`: the only form the releases API takes.
#[derive(Debug, Clone)]
struct RepositoryName;

impl Pattern for RepositoryName {
    const MESSAGE: &str = "must be owner/repo";

    fn regex() -> &'static Regex {
        static REPOSITORY: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").expect("the pattern is valid")
        });

        &REPOSITORY
    }
}

/// A symbol as Finnhub writes it: `AAPL`, a share class `BRK.B`, or a listing outside the US with its exchange
/// suffix, `AIR.PA`.
#[derive(Debug, Clone)]
struct TickerSymbol;

impl Pattern for TickerSymbol {
    const MESSAGE: &str = "must be an uppercase symbol, such as AAPL, BRK.B or AIR.PA";

    fn regex() -> &'static Regex {
        static TICKER: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"^[A-Z0-9][A-Z0-9.-]{0,19}$").expect("the pattern is valid")
        });

        &TICKER
    }
}

/// An http(s) URL, as zod's `z.url({ protocol: /^https?$/ })` takes it: trimmed, with `://`, which the WHATWG
/// parser accepts, and kept without the tabs and newlines that parser drops. `frigate:5000` is not one: it would
/// parse as the scheme `frigate:`.
struct ServiceUrl(String);

impl<'de> Deserialize<'de> for ServiceUrl {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        let trimmed = text.trim();
        let has_http_scheme = ["http://", "https://"].iter().any(|scheme| {
            trimmed
                .get(..scheme.len())
                .is_some_and(|start| start.eq_ignore_ascii_case(scheme))
        });

        if !has_http_scheme || url::Url::parse(trimmed).is_err() {
            return Err(de::Error::custom("must be an http or https URL"));
        }

        Ok(Self(trimmed.replace(['\t', '\n', '\r'], "")))
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{Column, ServiceOptions, Widget, WidgetKind};
    use crate::store::Yaml;

    fn parse(source: &str) -> Result<Widget, String> {
        let declaration = Yaml::load(source).expect("the YAML is valid");

        Widget::parse(0, &declaration).map_err(|error| error.to_string())
    }

    #[test]
    fn reads_a_widget_with_its_options() {
        let widget = parse(
            "{ type: github-releases, column: 3, ttl: 600, repositories: [glanceapp/glance] }",
        )
        .expect("the declaration is valid");

        assert_eq!(widget.column, Column::Third);
        assert_eq!(
            widget.kind,
            WidgetKind::GithubReleases {
                ttl: Some(Duration::from_secs(600)),
                repositories: vec!["glanceapp/glance".to_owned()],
            }
        );
    }

    #[test]
    fn knows_every_type_of_the_waku_version() {
        for widget_type in Widget::TYPES {
            let error = parse(&format!("{{ type: {widget_type}, column: 0 }}"))
                .expect_err("column 0 does not exist");

            assert!(
                !error.contains("unknown widget type"),
                "{widget_type}: {error}"
            );
        }

        let clock = parse("{ type: clock, column: 0 }").expect_err("column 0 does not exist");

        assert_eq!(clock, "widgets[0].column: must be from 1 to 3");
    }

    #[test]
    fn rejects_an_unknown_type_naming_the_field() {
        let error = parse("{ type: relases, column: 3 }").expect_err("the type does not exist");

        assert!(
            error.starts_with("widgets[0].type: unknown widget type `relases`"),
            "{error}"
        );
    }

    #[test]
    fn names_the_field_at_fault_inside_the_options() {
        let missing =
            parse("{ type: jellyfin-latest, column: 2 }").expect_err("the user is required");
        let card =
            parse("{ type: tcg-collector-cards, column: 1, cards: [{ game: 1, product: -1 }] }")
                .expect_err("an id is not negative");

        assert_eq!(missing, "widgets[0].user: missing field `user`");
        assert_eq!(
            card,
            "widgets[0].cards[0].product: must be from 0 to 999999999"
        );
    }

    #[test]
    fn takes_an_http_url_trimmed_and_nothing_else() {
        let widget = parse("{ type: frigate-events, column: 3, url: ' http://frigate:5000 ' }")
            .expect("an http URL is valid");

        assert_eq!(
            widget.kind,
            WidgetKind::FrigateEvents {
                service: ServiceOptions {
                    url: Some("http://frigate:5000".to_owned()),
                    ..ServiceOptions::default()
                },
            }
        );

        for url in ["frigate:5000", "ftp://frigate", "http:frigate", "https://"] {
            assert!(
                parse(&format!(
                    "{{ type: frigate-events, column: 3, url: '{url}' }}"
                ))
                .is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn ignores_the_fields_a_type_does_not_take() {
        let widget =
            parse("{ type: clock, column: 1, url: not-a-url }").expect("a clock reads no URL");

        assert_eq!(widget.kind, WidgetKind::Clock);
    }

    #[test]
    fn applies_the_rules_of_each_type() {
        let invalid = [
            "{ type: github-releases, column: 1, repositories: [glance] }",
            "{ type: github-releases, column: 1, repositories: [] }",
            "{ type: stock-prices, column: 1, tickers: [aapl] }",
            "{ type: stock-prices, column: 1, tickers: [A, B, C, D, E, F, G, H, I, J, K] }",
            "{ type: stock-prices, column: 1, tickers: [AAPL, AAPL] }",
            "{ type: forgejo-ci, column: 1, owners: [] }",
            "{ type: forgejo-ci, column: 1, owners: ['a b'] }",
            "{ type: jellyfin-latest, column: 1, user: '' }",
            "{ type: tcg-collector-cards, column: 1, days: 3651, cards: [{ game: 1, product: 1 }] }",
            "{ type: tcg-collector-cards, column: 1, cards: [] }",
            "{ type: miniflux-entries, column: 1, ttl: 0 }",
            "{ type: miniflux-entries, column: 1, ttl: null }",
            "type: clock",
            "[clock]",
        ];

        for declaration in invalid {
            assert!(parse(declaration).is_err(), "{declaration}");
        }
    }

    #[test]
    fn defaults_the_days_of_the_price_curves_to_30() {
        let widget =
            parse("{ type: tcg-collector-cards, column: 1, cards: [{ game: 21, product: 7 }] }")
                .expect("the declaration is valid");
        let WidgetKind::TcgCollectorCards { days, cards, .. } = widget.kind else {
            panic!("the widget is tcg-collector-cards");
        };

        assert_eq!(days, 30);
        assert_eq!((cards[0].game, cards[0].product), (21, 7));
    }
}
