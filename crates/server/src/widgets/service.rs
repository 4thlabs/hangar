//! Where a widget's service is: the address the server calls, the one the browser opens, and its key, as the Waku
//! version resolves them.

use std::fmt;
use std::time::Duration;

use hangar_core::{Runtime, ServiceOptions, Store, WidgetKind};
use http::header::{AUTHORIZATION, HeaderValue};
use quoll::Route;
use quoll::client::{self, Builder, Contract};
use reqwest::Request;
use reqwest_middleware::Middleware;

use super::error::LoadError;

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
    /// leave `Authorization` to its `Bearer` and `Basic`, and send a key as it is: until a scheme can say the form of
    /// its value, the header is written here. The value is marked sensitive, as quoll marks a key's.
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

    /// The store app a widget of `kind` reads, and where its declaration says it is; `None` for a widget that reads
    /// none, as the clock or GitHub's releases.
    pub(crate) fn options(kind: &WidgetKind) -> Option<(&'static str, &ServiceOptions)> {
        let read = match kind {
            WidgetKind::ArcaneGeneralStats { service } => ("arcane", service),
            WidgetKind::BackrestSummary { service } => ("backrest", service),
            WidgetKind::BeszelServerStats { service } => ("beszel", service),
            WidgetKind::ForgejoCi { service, .. } => ("forgejo", service),
            WidgetKind::FrigateEvents { service } => ("frigate", service),
            WidgetKind::GluetunVpnStatus { service } => ("gluetun", service),
            WidgetKind::MinifluxEntries { service } => ("miniflux", service),
            WidgetKind::JellyfinLatest { service, .. } => ("jellyfin", service),
            WidgetKind::TcgCollectorCards { service, .. } => ("tcg-collector", service),
            _ => return None,
        };

        Some(read)
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
