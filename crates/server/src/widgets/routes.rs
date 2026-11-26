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

    /// The types of image the relay sends: rasters, which hold no script.
    const RASTER_TYPES: [&str; 5] = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
    ];

    /// What quoll calls the bytes of an answer that gives no `Content-Type`.
    const NO_TYPE: &str = "application/octet-stream";

    /// The type of an image its service gives none, as the Waku version sent it.
    const DEFAULT_TYPE: &str = "image/jpeg";

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
            .filter_map(|placement| self.placement(placement, &apps))
            .collect())
    }

    /// A placement as the page reads it, its link that of its app among `apps`; `None`, logged, for a widget the
    /// contract has no type of, which the page could not show: the others still are.
    fn placement(&self, placement: Placement, apps: &[StoreApp]) -> Option<WidgetPlacement> {
        let kind = &placement.widget.kind;
        let Some(widget) = Self::widget_type(kind) else {
            tracing::warn!(
                widget = kind.name(),
                "leaving a widget the contract has no type of off the dashboard"
            );

            return None;
        };
        let link = Service::options(kind).map(|(app, options)| {
            let container = apps
                .iter()
                .find(|candidate| candidate.id == app)
                .map_or(app, |found| found.container_name.as_str());

            Service::link(container, &self.domain, options)
        });

        Some(WidgetPlacement {
            key: placement.key,
            widget,
            column: placement.widget.column.number(),
            link,
        })
    }

    /// The `type` of a widget of `kind`, as the contract writes it; `None` for a kind the core has and the contract
    /// not yet: `WidgetKind` may grow.
    fn widget_type(kind: &WidgetKind) -> Option<WidgetType> {
        match kind {
            WidgetKind::Clock => Some(WidgetType::Clock),
            WidgetKind::DockerGeneralStats => Some(WidgetType::DockerGeneralStats),
            WidgetKind::ArcaneGeneralStats { .. } => Some(WidgetType::ArcaneGeneralStats),
            WidgetKind::BackrestSummary { .. } => Some(WidgetType::BackrestSummary),
            WidgetKind::BeszelServerStats { .. } => Some(WidgetType::BeszelServerStats),
            WidgetKind::ForgejoCi { .. } => Some(WidgetType::ForgejoCi),
            WidgetKind::FrigateEvents { .. } => Some(WidgetType::FrigateEvents),
            WidgetKind::GluetunVpnStatus { .. } => Some(WidgetType::GluetunVpnStatus),
            WidgetKind::MinifluxEntries { .. } => Some(WidgetType::MinifluxEntries),
            WidgetKind::JellyfinLatest { .. } => Some(WidgetType::JellyfinLatest),
            WidgetKind::TcgCollectorCards { .. } => Some(WidgetType::TcgCollectorCards),
            WidgetKind::GithubReleases { .. } => Some(WidgetType::GithubReleases),
            WidgetKind::StockPrices { .. } => Some(WidgetType::StockPrices),
            _ => None,
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
        let fetched = self.loader(key).image(kind, id).await.map_err(|error| {
            Failure::logged(
                ErrorCode::WidgetUnavailable {
                    widget: kind.name().to_owned(),
                },
                &error,
            )
        })?;
        let image = fetched.ok_or_else(unknown)?;

        Self::raster(image).ok_or_else(|| unknown().into())
    }

    /// `image` as the relay sends it: a raster image, of a type of [`RASTER_TYPES`](Self::RASTER_TYPES), or one of no
    /// type, which the services give their JPEGs, as JPEG. Anything else is refused and logged: a page of errors the
    /// service or a proxy answers, or an SVG, which may hold a script that would run on Hangar's origin, with its
    /// session, opened at the relay's URL.
    fn raster(image: Bytes) -> Option<Bytes> {
        if image.has_type(Self::NO_TYPE) {
            return Some(image.with_content_type(Self::DEFAULT_TYPE));
        }

        if Self::RASTER_TYPES
            .iter()
            .any(|raster| image.has_type(raster))
        {
            return Some(image);
        }

        tracing::warn!(
            content_type = image.content_type(),
            "a widget's service answered an image the relay does not send"
        );

        None
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
    use quoll::Bytes;

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

    #[test]
    fn relays_a_raster_image_whatever_the_case_of_its_type_and_one_of_no_type_as_a_jpeg() {
        let relayed = |content_type: &str| {
            WidgetsState::raster(Bytes::from(vec![1, 2]).with_content_type(content_type))
                .map(|image| image.content_type().to_owned())
        };

        assert_eq!(relayed("Image/PNG"), Some("Image/PNG".to_owned()));
        assert_eq!(
            relayed("image/webp; q=1"),
            Some("image/webp; q=1".to_owned())
        );
        assert_eq!(
            relayed("application/octet-stream"),
            Some("image/jpeg".to_owned())
        );

        for refused in ["image/svg+xml", "text/html", "image/x-icon"] {
            assert_eq!(relayed(refused), None, "{refused}");
        }
    }
}
