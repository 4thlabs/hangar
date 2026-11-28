//! The dashboard's widgets: where `hangar.yml` places them, and the key of each placement, which its card's reads of
//! its service, through the routes of `Services`, go by.

mod placement;
mod routes;

use std::sync::Arc;

use hangar_core::{Runtime, Store};

use crate::Settings;
pub(crate) use placement::Placement;

/// What the widgets' route runs on: the store, whose `hangar.yml` places them, and the domain their links are under.
#[derive(Debug)]
pub(crate) struct WidgetsState {
    store: Arc<Store<Runtime>>,
    /// The domain the apps are served under, which a service's default link is under.
    domain: String,
}

impl WidgetsState {
    /// The widgets of the store of `settings`, read with `runtime`.
    pub(crate) fn new(settings: &Settings, runtime: Runtime) -> Arc<Self> {
        Arc::new(Self {
            store: Arc::new(Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime,
            )),
            domain: settings.domain.clone(),
        })
    }
}
