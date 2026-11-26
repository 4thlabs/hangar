//! The dashboard's widgets: where `hangar.yml` places them, what each loads from its service through a quoll contract
//! of its own, kept per placement, and the images they show, relayed from their service.

mod arcane;
mod backrest;
mod cache;
mod error;
mod frigate;
mod gluetun;
mod placement;
mod routes;
mod service;
mod time;

use std::sync::Arc;
use std::time::Duration;

use hangar_api::{ErrorCode, WidgetData};
use hangar_core::{Runtime, Store, WidgetKind};
use quoll::{Bytes, client};
use reqwest_middleware::ClientWithMiddleware;

use crate::Settings;
use crate::failure::Failure;
use cache::{Kept, Policy};
use error::LoadError;
use placement::Placement;
use service::Service;

/// What the widgets' routes run on: the store, whose `hangar.yml` places them, the client their contracts share, and
/// what each placement loaded.
#[derive(Debug)]
pub(crate) struct WidgetsState {
    store: Arc<Store<Runtime>>,
    /// The domain the apps are served under, which a service's default address is under.
    domain: String,
    http: ClientWithMiddleware,
    /// What each placement loaded, by its key.
    loads: Arc<Kept<WidgetData>>,
}

impl WidgetsState {
    /// How long a widget's data is served as it is when `hangar.yml` gives it no `ttl`: the dashboard does not read it
    /// again by itself, so this is what a visit sees.
    const FRESH: Duration = Duration::from_secs(60);

    /// How long past its `ttl` a widget's data is still served while it reloads: how long a service that stopped
    /// answering keeps showing its last card.
    const STALE: Duration = Duration::from_secs(15 * 60);

    /// How long a call to a service may take, whatever it is: one that hangs fails its card rather than hold it.
    const DEADLINE: Duration = Duration::from_secs(10);

    /// How many times a call is tried again: once, which gets past a dropped connection without holding the card
    /// behind a dead service.
    const RETRIES: u32 = 1;

    /// What the server calls the services as.
    const USER_AGENT: &str = concat!("hangar/", env!("CARGO_PKG_VERSION"));

    /// The widgets of the store of `settings`, read with `runtime`.
    ///
    /// # Panics
    ///
    /// When the HTTP client cannot be built, as when the system's TLS settings do not load: no widget could then be
    /// read.
    pub(crate) fn new(settings: &Settings, runtime: Runtime) -> Arc<Self> {
        let http = client::builder()
            .with(client::user_agent(Self::USER_AGENT))
            .with(client::retry(Self::RETRIES))
            .with(client::timeout(Self::DEADLINE))
            .build_http()
            .expect("the HTTP client of the widgets builds");

        Arc::new(Self {
            store: Arc::new(Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime,
            )),
            domain: settings.domain.clone(),
            http,
            loads: Kept::new("widget"),
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

        if !Self::loads(&placement.widget.kind) {
            return Err(unknown().into());
        }

        Ok(placement)
    }

    /// Whether a widget loads data of its own, rather than none, as the clock, or the Docker routes', as Docker's
    /// stats.
    fn loads(kind: &WidgetKind) -> bool {
        !matches!(kind, WidgetKind::Clock | WidgetKind::DockerGeneralStats)
    }

    /// What the widget of `placement` loaded, kept: fresh for its `ttl`, then served while it reloads, then awaited.
    async fn data(&self, placement: Placement) -> quoll::Result<WidgetData> {
        let kind = placement.widget.kind;
        let policy = Policy {
            fresh: Self::ttl(&kind).unwrap_or(Self::FRESH),
            stale: Self::STALE,
        };
        let widget = kind.name();
        let loader = self.loader();
        let loaded = self
            .loads
            .get(&placement.key, policy, move || loader.load(kind))
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

    /// What loads the widgets, and fetches their images.
    fn loader(&self) -> Loader {
        Loader {
            store: Arc::clone(&self.store),
            domain: self.domain.clone(),
            http: self.http.clone(),
        }
    }

    /// The `ttl` `hangar.yml` gives a widget, if it does.
    fn ttl(kind: &WidgetKind) -> Option<Duration> {
        match kind {
            WidgetKind::GithubReleases { ttl, .. } | WidgetKind::StockPrices { ttl, .. } => *ttl,
            other => Service::options(other).and_then(|(_, options)| options.ttl),
        }
    }

    /// Forgets what the widgets no longer placed loaded, so that a `hangar.yml` changed over and over does not grow the
    /// cache.
    fn forget_unplaced(&self, placed: &[Placement]) {
        self.loads
            .retain(|key| placed.iter().any(|placement| placement.key == key));
    }
}

/// What a load needs, apart from the widget: owned, as the load outlives the request that started it.
struct Loader {
    store: Arc<Store<Runtime>>,
    domain: String,
    http: ClientWithMiddleware,
}

impl Loader {
    /// The data of a widget of `kind`, from its service.
    async fn load(self, kind: WidgetKind) -> Result<WidgetData, LoadError> {
        match &kind {
            WidgetKind::ArcaneGeneralStats { .. } => {
                let service = self.service(&kind).await?;

                arcane::load(&self.http, &service)
                    .await
                    .map(WidgetData::ArcaneGeneralStats)
            }
            WidgetKind::BackrestSummary { .. } => {
                let service = self.service(&kind).await?;

                backrest::load(&self.http, &service)
                    .await
                    .map(WidgetData::BackrestSummary)
            }
            WidgetKind::FrigateEvents { .. } => {
                let service = self.service(&kind).await?;

                frigate::load(&self.http, &service)
                    .await
                    .map(WidgetData::FrigateEvents)
            }
            WidgetKind::GluetunVpnStatus { .. } => {
                let service = self.service(&kind).await?;

                gluetun::load(&self.http, &service)
                    .await
                    .map(WidgetData::GluetunVpnStatus)
            }
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
                frigate::thumbnail(&self.http, &self.service(kind).await?, id).await
            }
            _ => Ok(None),
        }
    }

    /// The service of a widget of `kind`, which reads a store app.
    async fn service(&self, kind: &WidgetKind) -> Result<Service, LoadError> {
        let (app, options) = Service::options(kind).ok_or_else(|| {
            LoadError::refused(format!("the {} widget reads no store app", kind.name()))
        })?;

        Service::resolve(&self.store, &self.domain, app, options).await
    }
}
