//! The routes of the group `Widgets`: the placements, what each loaded, and the images it shows.

use hangar_api::{ErrorCode, WidgetData, WidgetPlacement, WidgetType, WidgetsServer};
use hangar_core::{StoreApp, WidgetKind};
use http::header::CACHE_CONTROL;
use quoll::{Bytes, Response, Result};

use super::{Placement, WidgetsState};
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;
use crate::services::{Declared, Image, Service};

impl WidgetsState {
    /// The widgets `hangar.yml` places, with their links. What the widgets no longer placed loaded is forgotten.
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
        let placed = Placement::all(config.widgets);

        self.forget_unplaced(&placed);

        Ok(placed
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

    /// The image `id` of the widget placed as `key`, from its service, if it relays images and the service has it.
    async fn image(&self, key: &str, id: &str) -> Result<Bytes> {
        let unknown = || ErrorCode::UnknownImage {
            key: key.to_owned(),
            image: id.to_owned(),
        };

        if !Image::is_service_id(id) {
            return Err(unknown().into());
        }

        let placement = self.loading(key).await?;
        let kind = &placement.widget.kind;
        let fetched = self.loader(key).image(kind, id).await.map_err(|error| {
            Failure::logged(
                ErrorCode::WidgetUnavailable {
                    widget: kind.name().to_owned(),
                },
                &error,
            )
        })?;
        let image = fetched.ok_or_else(unknown)?;

        Image::raster(image).ok_or_else(|| unknown().into())
    }
}

impl WidgetsServer for App {
    async fn placements(&self, _: &SignedIn) -> Result<Response<Vec<WidgetPlacement>>> {
        Ok(Response::new(self.widgets.placements().await?))
    }

    async fn data(&self, _: &SignedIn, key: String) -> Result<Response<WidgetData>> {
        let placement = self.widgets.loading(&key).await?;

        Ok(Response::new(self.widgets.data(placement).await?))
    }

    async fn image(&self, _: &SignedIn, key: String, id: String) -> Result<Response<Bytes>> {
        let image = self.widgets.image(&key, &id).await?;

        Ok(Response::new(image).header(CACHE_CONTROL, Image::CACHE))
    }
}
