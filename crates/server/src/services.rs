//! The services the dashboard's widgets read, one route each: where a placement's service is, by the one `match` that
//! reads a declaration of `hangar.yml` into its service and its options; the client of each service, with its key;
//! each part of a service, a call of it, kept by the call; and the images the parts name, relayed.

mod cache;
mod clients;
mod error;
mod images;
mod jellyfin;
mod routes;
mod time;

use std::collections::HashSet;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use hangar_api::ErrorCode;
use hangar_core::{Runtime, ServiceOptions, Store, WidgetKind};
use http::header::{AUTHORIZATION, HeaderValue};
use quoll::Route;
use quoll::client::{self, Builder, Contract};
use reqwest::Request;
use reqwest_middleware::Middleware;

use crate::Settings;
use crate::failure::Failure;
use crate::widgets::Placement;
pub(crate) use cache::{Kept, Policy};
pub(crate) use error::LoadError;
pub(crate) use images::Image;
use jellyfin::Jellyfin;
pub(crate) use time::Moment;

/// What the services' routes run on: the store, whose `hangar.yml` places the widgets and whose `.env.global` holds
/// the services' keys, and each service, with its clients and its calls kept.
#[derive(Debug)]
pub(crate) struct ServicesState {
    store: Arc<Store<Runtime>>,
    /// The domain the apps are served under, which a service's default address is under.
    domain: Arc<str>,
    jellyfin: Jellyfin,
}

impl ServicesState {
    /// The services of the store of `settings`, read with `runtime`.
    pub(crate) fn new(settings: &Settings, runtime: Runtime) -> Arc<Self> {
        Arc::new(Self {
            store: Arc::new(Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime,
            )),
            domain: settings.domain.as_str().into(),
            jellyfin: Jellyfin::new(),
        })
    }

    /// What a service's route answers for the widget placed as `key`. `pick` takes from its declaration the service
    /// and what the read needs of it, `None` for a widget of another service, a 404; `read` reads the parts, a 502 when
    /// one asked failed with no value kept. The service is resolved inside a part's load, never before the cache.
    async fn read<Needs, T, F>(
        &self,
        key: &str,
        pick: impl for<'a> FnOnce(Declared<'a>) -> Option<(ServiceAt<'a>, Needs)>,
        read: impl FnOnce(Locator, Needs) -> F,
    ) -> quoll::Result<T>
    where
        F: Future<Output = Result<T, Arc<LoadError>>>,
    {
        let (placement, declared) = self.placement(key).await?;
        let found = Declared::of(&placement.widget.kind);
        let policy = found.policy();
        let (at, needs) = pick(found).ok_or_else(|| Self::unknown(key))?;
        let locator = self.locator(at, policy, declared);

        read(locator, needs)
            .await
            .map_err(|error| Self::unavailable(&placement, &error))
    }

    /// The widget placed as `key`, as `hangar.yml` places it now, and where every declaration of it says its service
    /// is.
    async fn placement(&self, key: &str) -> quoll::Result<(Placement, Arc<HashSet<ServiceKey>>)> {
        let config = self
            .store
            .config()
            .await
            .map_err(|error| Failure::store(ErrorCode::ConfigUnreadable, &error))?;
        let declared = config
            .widgets
            .iter()
            .filter_map(|widget| Declared::of(&widget.kind).service().map(ServiceAt::key))
            .collect();
        let placement = Placement::all(config.widgets)
            .into_iter()
            .find(|placement| placement.key == key)
            .ok_or_else(|| Self::unknown(key))?;

        Ok((placement, Arc::new(declared)))
    }

    /// What finds the service `at`, kept by `policy`, among the services `declared`.
    fn locator(
        &self,
        at: ServiceAt<'_>,
        policy: Policy,
        declared: Arc<HashSet<ServiceKey>>,
    ) -> Locator {
        Locator {
            app: at.app,
            options: at.options.clone(),
            policy,
            store: Arc::clone(&self.store),
            domain: Arc::clone(&self.domain),
            declared,
        }
    }

    /// The answer to a key that places no widget of the service asked: none at all, or one of another service.
    fn unknown(key: &str) -> quoll::Error {
        ErrorCode::UnknownPlacement {
            key: key.to_owned(),
        }
        .into()
    }

    /// The answer to a read whose service did not answer, logged whole, for the widget of `placement`.
    fn unavailable(placement: &Placement, error: &LoadError) -> quoll::Error {
        Failure::logged(
            ErrorCode::WidgetUnavailable {
                widget: placement.widget.kind.name().to_owned(),
            },
            error,
        )
    }
}

/// What a declaration of `hangar.yml` says of the service its widget reads: which, where, and the options it gives
/// it. One `match` reads every type of widget into it: a type added to the core is a compile error there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Declared<'a> {
    /// The clock and Docker's stats: no service is read through these routes.
    Nothing,
    /// Arcane.
    Arcane(ServiceAt<'a>),
    /// Backrest.
    Backrest(ServiceAt<'a>),
    /// Beszel.
    Beszel(ServiceAt<'a>),
    /// Forgejo.
    Forgejo(ServiceAt<'a>),
    /// Frigate.
    Frigate(ServiceAt<'a>),
    /// Gluetun.
    Gluetun(ServiceAt<'a>),
    /// Miniflux.
    Miniflux(ServiceAt<'a>),
    /// Jellyfin, and the user whose latest items are read: Jellyfin has none of the whole server.
    Jellyfin {
        /// Where it is.
        at: ServiceAt<'a>,
        /// The user.
        user: &'a str,
    },
    /// tcg-collector.
    TcgCollector(ServiceAt<'a>),
    /// GitHub's public API, at the server's own address.
    Github {
        /// How long its calls stay fresh; `None`, the default.
        ttl: Option<Duration>,
    },
    /// Finnhub's public API, at the server's own address, with the server's key.
    Finnhub {
        /// How long its calls stay fresh; `None`, the default.
        ttl: Option<Duration>,
    },
}

impl<'a> Declared<'a> {
    /// How long a call is served as it is when the declaration gives no `ttl`: the dashboard does not read it again by
    /// itself, so this is what a visit sees.
    const FRESH: Duration = Duration::from_secs(60);

    /// How long past its `ttl` a call is still served while it is made again: how long a service that stopped
    /// answering keeps showing its last answer.
    const STALE: Duration = Duration::from_secs(15 * 60);

    /// What the declaration of a widget of `kind` says of its service.
    pub(crate) fn of(kind: &'a WidgetKind) -> Self {
        match kind {
            WidgetKind::Clock | WidgetKind::DockerGeneralStats => Self::Nothing,
            WidgetKind::ArcaneGeneralStats { service } => {
                Self::Arcane(ServiceAt::new("arcane", service))
            }
            WidgetKind::BackrestSummary { service } => {
                Self::Backrest(ServiceAt::new("backrest", service))
            }
            WidgetKind::BeszelServerStats { service } => {
                Self::Beszel(ServiceAt::new("beszel", service))
            }
            WidgetKind::ForgejoCi { service, .. } => {
                Self::Forgejo(ServiceAt::new("forgejo", service))
            }
            WidgetKind::FrigateEvents { service } => {
                Self::Frigate(ServiceAt::new("frigate", service))
            }
            WidgetKind::GluetunVpnStatus { service } => {
                Self::Gluetun(ServiceAt::new("gluetun", service))
            }
            WidgetKind::MinifluxEntries { service } => {
                Self::Miniflux(ServiceAt::new("miniflux", service))
            }
            WidgetKind::JellyfinLatest { service, user } => Self::Jellyfin {
                at: ServiceAt::new("jellyfin", service),
                user,
            },
            WidgetKind::TcgCollectorCards { service, .. } => {
                Self::TcgCollector(ServiceAt::new("tcg-collector", service))
            }
            WidgetKind::GithubReleases { ttl, .. } => Self::Github { ttl: *ttl },
            WidgetKind::StockPrices { ttl, .. } => Self::Finnhub { ttl: *ttl },
        }
    }

    /// The store app it reads, and where; `None` for a widget that reads none, as the clock or GitHub's releases.
    pub(crate) fn service(&self) -> Option<&ServiceAt<'a>> {
        match self {
            Self::Arcane(at)
            | Self::Backrest(at)
            | Self::Beszel(at)
            | Self::Forgejo(at)
            | Self::Frigate(at)
            | Self::Gluetun(at)
            | Self::Miniflux(at)
            | Self::Jellyfin { at, .. }
            | Self::TcgCollector(at) => Some(at),
            Self::Nothing | Self::Github { .. } | Self::Finnhub { .. } => None,
        }
    }

    /// How long the calls it makes are kept: fresh for its `ttl`, else a minute, then stale for 15 minutes.
    pub(crate) fn policy(&self) -> Policy {
        let ttl = match self {
            Self::Github { ttl } | Self::Finnhub { ttl } => *ttl,
            Self::Nothing => None,
            Self::Arcane(at)
            | Self::Backrest(at)
            | Self::Beszel(at)
            | Self::Forgejo(at)
            | Self::Frigate(at)
            | Self::Gluetun(at)
            | Self::Miniflux(at)
            | Self::Jellyfin { at, .. }
            | Self::TcgCollector(at) => at.options.ttl,
        };

        Policy {
            fresh: ttl.unwrap_or(Self::FRESH),
            stale: Self::STALE,
        }
    }
}

/// Where a store app's service is, as one declaration gives it: its app, its `url` and `link`, and its `ttl`. Two
/// declarations that resolve to the same address share its client and its calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ServiceAt<'a> {
    /// The store app, as `jellyfin`.
    pub(crate) app: &'static str,
    /// Where the declaration says it is.
    pub(crate) options: &'a ServiceOptions,
}

impl<'a> ServiceAt<'a> {
    fn new(app: &'static str, options: &'a ServiceOptions) -> Self {
        Self { app, options }
    }

    /// Where it is, as the declaration writes it.
    pub(crate) fn key(&self) -> ServiceKey {
        ServiceKey {
            app: self.app,
            address: self
                .options
                .url
                .clone()
                .or_else(|| self.options.link.clone()),
        }
    }
}

/// Where a service is, as its declaration writes it, read without the store: its app, and the address the server calls
/// it at, `url`, else `link`, `None` for the default one under the domain. Two declarations of one key read one service:
/// it keys the service's client and its calls.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ServiceKey {
    app: &'static str,
    address: Option<String>,
}

/// What a read takes of its service: where its declaration says it is, how long its calls are kept, and what resolves
/// its address and key, which a part does only when it loads: on a miss or a stale value, never for a fresh one.
#[derive(Debug, Clone)]
pub(crate) struct Locator {
    app: &'static str,
    options: ServiceOptions,
    policy: Policy,
    store: Arc<Store<Runtime>>,
    domain: Arc<str>,
    /// Where every declaration of `hangar.yml` says its service is, as it was read for this read.
    declared: Arc<HashSet<ServiceKey>>,
}

impl Locator {
    /// Where the service is, as its declaration writes it.
    pub(crate) fn key(&self) -> ServiceKey {
        ServiceAt::new(self.app, &self.options).key()
    }

    /// How long its calls are kept.
    pub(crate) fn policy(&self) -> Policy {
        self.policy
    }

    /// Whether a declaration of `hangar.yml` still names the service of `key`.
    pub(crate) fn is_declared(&self, key: &ServiceKey) -> bool {
        self.declared.contains(key)
    }

    /// The service, with its key, resolved now: the store's apps give its container, `.env.global` its key.
    ///
    /// # Errors
    ///
    /// When the store's apps or `.env.global` cannot be read.
    pub(crate) async fn service(&self) -> Result<Service, LoadError> {
        Service::resolve(&self.store, &self.domain, self.app, &self.options).await
    }
}

/// The service a widget reads: a store app's.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Service {
    /// Where the server calls it: `url`, else the link.
    pub(crate) api: String,
    /// Where the browser opens it: `link`, else `https://<container>.<DOMAIN>`.
    pub(crate) link: String,
    /// Its key, `<CONTAINER>_API_KEY` of `.env.global`; `None` when it takes none, and then none is sent.
    pub(crate) key: Option<String>,
}

impl Service {
    /// The variable of `.env.global` a service's key is in, after its container's prefix.
    const KEY_SUFFIX: &str = "API_KEY";

    /// How long a call to a service may take, whatever it is: one that hangs fails its card rather than hold it.
    const DEADLINE: Duration = Duration::from_secs(10);

    /// How many times a call is tried again: once, which gets past a dropped connection without holding the card
    /// behind a dead service.
    const RETRIES: u32 = 1;

    /// What the server calls the services as.
    const USER_AGENT: &str = concat!("hangar/", env!("CARGO_PKG_VERSION"));

    /// The builder of every widget's client: tried again once, given 10 seconds.
    pub(crate) fn builder() -> Builder {
        client::builder()
            .with(client::user_agent(Self::USER_AGENT))
            .with(client::retry(Self::RETRIES))
            .with(client::timeout(Self::DEADLINE))
    }

    /// The client of the contract `A` at this service's address, with `credential`, which sends its key, when it has
    /// one; `name` names the service in the error.
    ///
    /// # Errors
    ///
    /// When the client cannot be built, as when the system's TLS settings do not load.
    pub(crate) fn client<A: Contract>(
        &self,
        name: &str,
        credential: Option<impl Middleware>,
    ) -> Result<A::Client, LoadError> {
        let builder = match credential {
            Some(credential) => Self::builder().with(credential),
            None => Self::builder(),
        };

        self.build::<A>(builder, name)
    }

    /// The credential that sends `value` as the `Authorization` of each call of a client, for a service whose key goes
    /// there in a form of its own: Beszel's raw token, Jellyfin's `MediaBrowser Token="..."`. quoll's header schemes
    /// leave `Authorization` to its `Bearer` and `Basic`, and send a key as it is: until a scheme of the client can say
    /// where and in which form its value goes, apart from the server's schemes (quoll#147), the header is written here.
    /// The value is marked sensitive, as quoll marks a key's.
    ///
    /// # Errors
    ///
    /// When `value` cannot be a header's, as one with a line break; it is not named.
    pub(crate) fn authorization(value: &str, name: &str) -> Result<impl Middleware, LoadError> {
        let mut header = HeaderValue::from_str(value).map_err(|_| {
            LoadError::refused(format!("the key of {name} cannot be sent in a header"))
        })?;

        header.set_sensitive(true);

        Ok(client::on_request(
            move |request: &mut Request, _: &Route| {
                request.headers_mut().insert(AUTHORIZATION, header.clone());
            },
        ))
    }

    /// The client of the contract `A` at this service's address, for a service that takes no key.
    ///
    /// # Errors
    ///
    /// When the client cannot be built.
    pub(crate) fn keyless_client<A: Contract>(&self, name: &str) -> Result<A::Client, LoadError> {
        self.build::<A>(Self::builder(), name)
    }

    fn build<A: Contract>(&self, builder: Builder, name: &str) -> Result<A::Client, LoadError> {
        builder
            .build::<A>(&self.api)
            .map_err(LoadError::call(format!("build the client of {name}")))
    }

    /// Where the browser opens the service of `container`: `link`, else `https://<container>.<domain>`.
    pub(crate) fn link(container: &str, domain: &str, options: &ServiceOptions) -> String {
        options
            .link
            .clone()
            .unwrap_or_else(|| format!("https://{container}.{domain}"))
    }

    /// The container `app` runs as, from the store's apps: `app` itself when the store has none of that id.
    pub(crate) async fn container(store: &Store<Runtime>, app: &str) -> Result<String, LoadError> {
        let apps = store.apps().await.map_err(|source| LoadError::Store {
            what: "apps",
            source,
        })?;

        Ok(apps
            .into_iter()
            .find(|candidate| candidate.id == app)
            .map_or_else(|| app.to_owned(), |found| found.container_name))
    }

    /// The service of `app` that `options` point at, with its key, read from `.env.global` now.
    pub(crate) async fn resolve(
        store: &Store<Runtime>,
        domain: &str,
        app: &str,
        options: &ServiceOptions,
    ) -> Result<Self, LoadError> {
        let container = Self::container(store, app).await?;
        let key = store
            .env()
            .app_variable(&container, Self::KEY_SUFFIX)
            .await
            .map_err(|source| LoadError::Store {
                what: "global environment",
                source,
            })?;
        let link = Self::link(&container, domain, options);

        Ok(Self {
            api: options.url.clone().unwrap_or_else(|| link.clone()),
            link,
            key,
        })
    }

    /// The key, for a route that sends it in a header of its own when there is one.
    pub(crate) fn key(&self) -> Option<&str> {
        self.key.as_deref()
    }
}

/// Shows whether there is a key, never the key.
impl fmt::Debug for Service {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Service")
            .field("api", &self.api)
            .field("link", &self.link)
            .field("has_key", &self.key.is_some())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use hangar_core::Config;

    use super::{Declared, ServiceAt};

    fn config(widgets: &str) -> Config {
        Config::parse(&format!("categories: []\nwidgets:\n{widgets}"))
            .expect("the configuration is valid")
    }

    #[test]
    fn keeps_a_call_for_the_ttl_of_its_declaration_or_a_minute_then_15_minutes_stale() {
        let config = config(
            "  - { type: miniflux-entries, column: 1, ttl: 5 }\n  - { type: github-releases, column: 1, \
             repositories: [a/b] }\n  - { type: stock-prices, column: 1, ttl: 600, tickers: [AAPL] }\n",
        );
        let fresh: Vec<_> = config
            .widgets
            .iter()
            .map(|widget| Declared::of(&widget.kind).policy())
            .map(|policy| (policy.fresh, policy.stale))
            .collect();
        let stale = Duration::from_secs(15 * 60);

        assert_eq!(
            fresh,
            [
                (Duration::from_secs(5), stale),
                (Duration::from_secs(60), stale),
                (Duration::from_secs(600), stale),
            ]
        );
    }

    #[test]
    fn reads_a_declaration_into_its_service_and_what_it_gives_it() {
        let config = config(
            "  - { type: clock, column: 1 }\n  - { type: jellyfin-latest, column: 2, user: ana, url: \
             'http://jellyfin:8096' }\n",
        );
        let declared: Vec<_> = config
            .widgets
            .iter()
            .map(|widget| Declared::of(&widget.kind))
            .collect();

        assert_eq!(declared[0], Declared::Nothing);

        let Declared::Jellyfin { at, user } = declared[1] else {
            panic!("a Jellyfin: {:?}", declared[1]);
        };

        assert_eq!((at.app, user), ("jellyfin", "ana"));
        assert_eq!(at.options.url.as_deref(), Some("http://jellyfin:8096"));
        assert_eq!(declared[1].service(), Some(&at));
        assert_eq!(declared[0].service(), None::<&ServiceAt<'_>>);
    }
}
