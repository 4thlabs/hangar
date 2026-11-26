//! The routes of the group `Widgets`: the placements, what each loaded, and the images it shows.

use hangar_api::{ErrorCode, WidgetData, WidgetPlacement, WidgetType, WidgetsServer};
use hangar_core::{StoreApp, WidgetKind};
use http::header::CACHE_CONTROL;
use quoll::{Bytes, Response, Result};

use super::service::Service;
use super::{Placement, WidgetsState};
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl WidgetsState {
    /// How long the browser keeps a relayed image: a poster or a thumbnail does not change, and a day spares the
    /// service the same call on each visit.
    const IMAGE_CACHE: &str = "private, max-age=86400";

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
        let link = Service::options(kind).map(|(app, options)| {
            let container = apps
                .iter()
                .find(|candidate| candidate.id == app)
                .map_or(app, |found| found.container_name.as_str());

            Service::link(container, &self.domain, options)
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
            other => unreachable!("the contract has no type for {}", other.name()),
        }
    }

    /// Whether `id` may be an image's id: letters, digits, `_`, `.` and `-`, as the services write theirs. Checked rather
    /// than escaped: the id goes in the service's path, and the relay is no proxy of the service. `.` and `..` would
    /// name the segment, or the one above it.
    fn is_image_id(id: &str) -> bool {
        let is_word = id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'));
        let is_dots = id.bytes().all(|byte| byte == b'.');

        !id.is_empty() && is_word && !is_dots
    }

    /// The image `id` of the widget placed as `key`, from its service, if it relays images and the service has it.
    async fn image(&self, key: &str, id: &str) -> Result<Bytes> {
        let unknown = || ErrorCode::UnknownImage {
            key: key.to_owned(),
            image: id.to_owned(),
        };
        if !Self::is_image_id(id) {
            return Err(unknown().into());
        }

        let placement = self.loading(key).await?;
        let kind = &placement.widget.kind;
        let fetched = self.loader().image(kind, id).await.map_err(|error| {
            Failure::logged(
                ErrorCode::WidgetUnavailable {
                    widget: kind.name().to_owned(),
                },
                &error,
            )
        })?;
        let image = fetched.ok_or_else(unknown)?;

        // A service answers its errors as pages, or a proxy in front of it does: the browser gets an image, or none.
        if !image.content_type().starts_with("image/") {
            tracing::warn!(
                key,
                content_type = image.content_type(),
                "a widget's service answered an image that is none"
            );

            return Err(unknown().into());
        }

        Ok(image)
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

        Ok(Response::new(image).header(CACHE_CONTROL, WidgetsState::IMAGE_CACHE))
    }
}

#[cfg(test)]
mod tests {
    use super::WidgetsState;

    #[test]
    fn takes_an_image_id_of_the_services_and_no_path() {
        for id in ["1700000000.5-abc", "6c1e2f0a9b", "21-755143", "a_b"] {
            assert!(WidgetsState::is_image_id(id), "{id}");
        }

        for id in ["", ".", "..", "a/b", "a b", "a%2Fb", "é"] {
            assert!(!WidgetsState::is_image_id(id), "{id}");
        }
    }
}
