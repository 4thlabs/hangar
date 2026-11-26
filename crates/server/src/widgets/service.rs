//! Where a widget's service is: the address the server calls, the one the browser opens, and its key, as the Waku
//! version resolves them.

use std::fmt;

use hangar_core::{Runtime, ServiceOptions, Store, WidgetKind};

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
