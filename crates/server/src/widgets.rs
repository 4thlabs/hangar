//! The dashboard's widgets: where `hangar.yml` places them, what each loads from its service through a quoll contract
//! of its own, kept per placement, and the images they show, relayed from their service.

mod arcane;
mod backrest;
mod beszel;
mod clients;
mod finnhub;
mod forgejo;
mod frigate;
mod github;
mod gluetun;
mod miniflux;
mod placement;
mod routes;
mod tcg_collector;

use std::sync::Arc;

use hangar_api::{ErrorCode, WidgetData};
use hangar_core::{Runtime, Store, WidgetKind};
use quoll::Bytes;

use crate::Settings;
use crate::failure::Failure;
use crate::services::{Declared, Kept, LoadError, Service};
use clients::Clients;
use finnhub::Finnhub;
use github::Github;
pub(crate) use placement::Placement;

/// What the widgets' routes run on: the store, whose `hangar.yml` places them, the client of each placement's service,
/// and what each placement loaded.
#[derive(Debug)]
pub(crate) struct WidgetsState {
    store: Arc<Store<Runtime>>,
    /// The domain the apps are served under, which a service's default address is under.
    domain: String,
    /// The client of each placement's service, by its key.
    clients: Arc<Clients>,
    /// What each placement loaded, by its key.
    loads: Arc<Kept<String, WidgetData>>,
    github: Github,
    finnhub: Finnhub,
}

impl WidgetsState {
    /// The widgets of the store of `settings`, read with `runtime`.
    ///
    /// # Panics
    ///
    /// When the client of GitHub or of Finnhub cannot be built, as when the system's TLS settings do not load: no
    /// widget could then be read.
    pub(crate) fn new(settings: &Settings, runtime: Runtime) -> Arc<Self> {
        Arc::new(Self {
            store: Arc::new(Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime,
            )),
            domain: settings.domain.clone(),
            clients: Arc::default(),
            loads: Kept::new("widget"),
            github: Github::new(settings),
            finnhub: Finnhub::new(settings),
        })
    }

    /// The widgets `hangar.yml` places, each under its key, read anew.
    async fn placed(&self) -> quoll::Result<Vec<Placement>> {
        let config = self
            .store
            .config()
            .await
            .map_err(|error| Failure::store(ErrorCode::ConfigUnreadable, &error))?;

        Ok(Placement::all(config.widgets))
    }

    /// The widget placed as `key`, which loads its data: not the clock, nor Docker's stats.
    async fn loading(&self, key: &str) -> quoll::Result<Placement> {
        let unknown = || ErrorCode::UnknownPlacement {
            key: key.to_owned(),
        };
        let placement = self
            .placed()
            .await?
            .into_iter()
            .find(|placement| placement.key == key)
            .ok_or_else(unknown)?;

        if Declared::of(&placement.widget.kind) == Declared::Nothing {
            return Err(unknown().into());
        }

        Ok(placement)
    }

    /// What the widget of `placement` loaded, kept: fresh for its `ttl`, then served while it reloads, then awaited.
    async fn data(&self, placement: Placement) -> quoll::Result<WidgetData> {
        let kind = placement.widget.kind;
        let policy = Declared::of(&kind).policy();
        let widget = kind.name();
        let loader = self.loader(&placement.key);
        let loaded = self
            .loads
            .get(placement.key, policy, move || loader.load(kind))
            .await;

        loaded.map(|data| (*data).clone()).map_err(|error| {
            Failure::logged(
                ErrorCode::WidgetUnavailable {
                    widget: widget.to_owned(),
                },
                &*error,
            )
        })
    }

    /// What loads the widget placed as `key`, and fetches its images.
    fn loader(&self, key: &str) -> Loader {
        Loader {
            key: key.to_owned(),
            store: Arc::clone(&self.store),
            domain: self.domain.clone(),
            clients: Arc::clone(&self.clients),
            github: self.github.clone(),
            finnhub: self.finnhub.clone(),
        }
    }

    /// Forgets what the widgets no longer placed loaded, so that a `hangar.yml` changed over and over does not grow the
    /// cache.
    fn forget_unplaced(&self, placed: &[Placement]) {
        let is_placed = |key: &str| placed.iter().any(|placement| placement.key == key);

        self.loads.retain(|key| is_placed(key));
        self.clients.retain(is_placed);
    }
}

/// What a load of a placement needs, apart from its widget: owned, as the load outlives the request that started it.
struct Loader {
    /// The placement's key.
    key: String,
    store: Arc<Store<Runtime>>,
    domain: String,
    clients: Arc<Clients>,
    github: Github,
    finnhub: Finnhub,
}

impl Loader {
    /// The data of a widget of `kind`, from its service.
    async fn load(self, kind: WidgetKind) -> Result<WidgetData, LoadError> {
        match &kind {
            WidgetKind::ArcaneGeneralStats { .. } => {
                let client = self.client(&kind, arcane::Client::new).await?;

                arcane::load(&client)
                    .await
                    .map(WidgetData::ArcaneGeneralStats)
            }
            WidgetKind::BackrestSummary { .. } => {
                let client = self.client(&kind, backrest::Client::new).await?;

                backrest::load(&client)
                    .await
                    .map(WidgetData::BackrestSummary)
            }
            WidgetKind::BeszelServerStats { .. } => {
                let client = self.client(&kind, beszel::Client::new).await?;

                beszel::load(&client)
                    .await
                    .map(WidgetData::BeszelServerStats)
            }
            WidgetKind::ForgejoCi { owners, .. } => {
                let client = self.client(&kind, forgejo::Client::new).await?;

                forgejo::load(&client, owners.as_deref())
                    .await
                    .map(WidgetData::ForgejoCi)
            }
            WidgetKind::FrigateEvents { .. } => {
                let client = self.client(&kind, frigate::Client::new).await?;

                frigate::load(&client).await.map(WidgetData::FrigateEvents)
            }
            WidgetKind::GluetunVpnStatus { .. } => {
                let client = self.client(&kind, gluetun::Client::new).await?;

                gluetun::load(&client)
                    .await
                    .map(WidgetData::GluetunVpnStatus)
            }
            WidgetKind::MinifluxEntries { .. } => {
                let client = self.client(&kind, miniflux::Client::new).await?;

                miniflux::load(&client)
                    .await
                    .map(WidgetData::MinifluxEntries)
            }
            WidgetKind::TcgCollectorCards { days, cards, .. } => {
                let client = self.client(&kind, tcg_collector::Client::new).await?;

                tcg_collector::load(&client, *days, cards)
                    .await
                    .map(WidgetData::TcgCollectorCards)
            }
            WidgetKind::GithubReleases { repositories, .. } => self
                .github
                .latest_releases(repositories)
                .await
                .map(WidgetData::GithubReleases),
            WidgetKind::StockPrices { tickers, .. } => self
                .finnhub
                .stocks(tickers)
                .await
                .map(WidgetData::StockPrices),
            other => Err(LoadError::refused(format!(
                "the {} widget loads nothing",
                other.name()
            ))),
        }
    }

    /// The image `id` of a widget of `kind`, from its service: `None` when the widget relays no image, or its service
    /// has none of this id.
    async fn image(&self, kind: &WidgetKind, id: &str) -> Result<Option<Bytes>, LoadError> {
        match kind {
            WidgetKind::FrigateEvents { .. } => {
                frigate::thumbnail(&self.client(kind, frigate::Client::new).await?, id).await
            }
            WidgetKind::TcgCollectorCards { .. } => {
                tcg_collector::image(&self.client(kind, tcg_collector::Client::new).await?, id)
                    .await
            }
            _ => Ok(None),
        }
    }

    /// The client of the placement's service, a widget of `kind` that reads a store app: the one `build` built for it
    /// before, unless its address or its key changed since.
    async fn client<C>(
        &self,
        kind: &WidgetKind,
        build: fn(&Service) -> Result<C, LoadError>,
    ) -> Result<C, LoadError>
    where
        C: Clone + Send + Sync + 'static,
    {
        let declared = Declared::of(kind);
        let at = declared.service().ok_or_else(|| {
            LoadError::refused(format!("the {} widget reads no store app", kind.name()))
        })?;
        let service = Service::resolve(&self.store, &self.domain, at.app, at.options).await?;

        self.clients.get(&self.key, service, build)
    }
}
