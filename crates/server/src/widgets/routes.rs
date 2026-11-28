//! The route of the group `Widgets`: the placements.

use hangar_api::{ErrorCode, WidgetPlacement, WidgetType, WidgetsServer};
use hangar_core::{StoreApp, WidgetKind};
use quoll::{Response, Result};

use super::{Placement, WidgetsState};
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;
use crate::services::{Declared, Service};

impl WidgetsState {
    /// The widgets `hangar.yml` places, with their links.
    async fn placements(&self) -> Result<Vec<WidgetPlacement>> {
        let config = self
            .store
            .config()
            .await
            .map_err(|error| Failure::store(ErrorCode::ConfigUnreadable, &error))?;
        let apps = self
            .store
            .apps_with(&config)
            .await
            .map_err(|error| Failure::store(ErrorCode::AppsUnreadable, &error))?;

        Ok(Placement::all(config.widgets)
            .into_iter()
            .map(|placement| self.placement(placement, &apps))
            .collect())
    }

    /// A placement as the page reads it, its link that of its app among `apps`.
    fn placement(&self, placement: Placement, apps: &[StoreApp]) -> WidgetPlacement {
        let kind = &placement.widget.kind;
        let link = Declared::of(kind).service().map(|at| {
            let container = apps
                .iter()
                .find(|candidate| candidate.id == at.app)
                .map_or(at.app, |found| found.container_name.as_str());

            Service::link(container, &self.domain, at.options)
        });

        WidgetPlacement {
            key: placement.key,
            widget: Self::widget_type(kind),
            column: placement.widget.column.number(),
            link,
        }
    }

    /// The `type` of a widget of `kind`, as the contract writes it.
    fn widget_type(kind: &WidgetKind) -> WidgetType {
        match kind {
            WidgetKind::Clock => WidgetType::Clock,
            WidgetKind::DockerGeneralStats => WidgetType::DockerGeneralStats,
            WidgetKind::ArcaneGeneralStats { .. } => WidgetType::ArcaneGeneralStats,
            WidgetKind::BackrestSummary { .. } => WidgetType::BackrestSummary,
            WidgetKind::BeszelServerStats { .. } => WidgetType::BeszelServerStats,
            WidgetKind::ForgejoCi { .. } => WidgetType::ForgejoCi,
            WidgetKind::FrigateEvents { .. } => WidgetType::FrigateEvents,
            WidgetKind::GluetunVpnStatus { .. } => WidgetType::GluetunVpnStatus,
            WidgetKind::MinifluxEntries { .. } => WidgetType::MinifluxEntries,
            WidgetKind::JellyfinLatest { .. } => WidgetType::JellyfinLatest,
            WidgetKind::TcgCollectorCards { .. } => WidgetType::TcgCollectorCards,
            WidgetKind::GithubReleases { .. } => WidgetType::GithubReleases,
            WidgetKind::StockPrices { .. } => WidgetType::StockPrices,
        }
    }
}

impl WidgetsServer for App {
    async fn placements(&self, _: &SignedIn) -> Result<Response<Vec<WidgetPlacement>>> {
        Ok(Response::new(self.widgets.placements().await?))
    }
}
