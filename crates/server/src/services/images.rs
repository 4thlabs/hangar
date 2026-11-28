//! The images the services' parts name, relayed by one route for every service: the server writes each image's id,
//! the page passes it as it is, and the relay reads it back into the image of one service. No address and no path is
//! taken from the request: the service is the widget's, and the image's path a fixed one of the service's contract.

use std::fmt;

use hangar_api::ErrorCode;
use quoll::Bytes;

use super::{Declared, ServicesState};

/// An image a service holds, as the server names it in a part: `<kind>.<the service's id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Image {
    /// `poster.<item>`: a Jellyfin item's primary image.
    JellyfinPoster(String),
}

impl Image {
    /// How long the browser keeps a relayed image: a poster or a thumbnail does not change, and a day spares the
    /// service the same call on each visit.
    pub(crate) const CACHE: &str = "private, max-age=86400";

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

    /// The image `id` names, as [`Display`](fmt::Display) writes it; `None` for an id the server would not write.
    pub(crate) fn parse(id: &str) -> Option<Self> {
        let (kind, service_id) = id.split_once('.')?;

        if !Self::is_service_id(service_id) {
            return None;
        }

        Self::VARIANTS
            .iter()
            .map(|variant| variant(service_id.to_owned()))
            .find(|image| image.kind() == kind)
    }

    /// Each variant, from its service's id, which `parse` tries by its kind.
    const VARIANTS: [fn(String) -> Self; 1] = [Self::JellyfinPoster];

    /// The kind it is written under, before its service's id: one `match`, which both `parse` and `Display` read.
    fn kind(&self) -> &'static str {
        match self {
            Self::JellyfinPoster(_) => "poster",
        }
    }

    /// The service's id of the image.
    fn service_id(&self) -> &str {
        match self {
            Self::JellyfinPoster(item) => item,
        }
    }

    /// Whether `id` may be a service's id of an image: letters, digits, `_`, `.` and `-`, as the services write theirs.
    /// Checked rather than escaped: the id goes in the service's path, and the relay is no proxy of the service. `.` and
    /// `..` would name the segment, or the one above it.
    pub(crate) fn is_service_id(id: &str) -> bool {
        let is_word = id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'));
        let is_dots = id.bytes().all(|byte| byte == b'.');

        !id.is_empty() && is_word && !is_dots
    }

    /// `image` as the relay sends it: a raster image, of a type of [`RASTER_TYPES`](Self::RASTER_TYPES), or one of no
    /// type, which the services give their JPEGs, as JPEG. Anything else is refused and logged: a page of errors the
    /// service or a proxy answers, or an SVG, which may hold a script that would run on Hangar's origin, with its
    /// session, opened at the relay's URL.
    pub(crate) fn raster(image: Bytes) -> Option<Bytes> {
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

/// The id the page passes back to the relay, as [`Image::parse`] reads it.
impl fmt::Display for Image {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.kind(), self.service_id())
    }
}

impl ServicesState {
    /// The image `id` of the service of the widget placed as `key`, if the id names one of its service's images and
    /// the service has it.
    pub(super) async fn image(&self, key: &str, id: &str) -> quoll::Result<Bytes> {
        let unknown = || ErrorCode::UnknownImage {
            key: key.to_owned(),
            image: id.to_owned(),
        };
        let image = Image::parse(id).ok_or_else(unknown)?;
        let (placement, declared) = self.placement(key).await?;
        let found = Declared::of(&placement.widget.kind);
        let policy = found.policy();
        // Exhaustive on the image: one of another service than the widget's is not the widget's to relay. The service is
        // resolved as the image is fetched: an image is not kept, the browser keeps it a day.
        let fetched = match &image {
            Image::JellyfinPoster(item) => {
                let Declared::Jellyfin { at, .. } = found else {
                    return Err(unknown().into());
                };

                self.jellyfin
                    .poster(&self.locator(at, policy, declared), item)
                    .await
            }
        };
        let fetched = fetched.map_err(|error| Self::unavailable(&placement, &error))?;

        Image::raster(fetched.ok_or_else(unknown)?).ok_or_else(|| unknown().into())
    }
}

#[cfg(test)]
mod tests {
    use quoll::Bytes;

    use super::Image;

    /// One image of each variant.
    fn every_image() -> Vec<Image> {
        vec![Image::JellyfinPoster("6c1e2f0a9b".to_owned())]
    }

    #[test]
    fn reads_back_the_id_it_writes_of_every_variant_and_no_other() {
        assert_eq!(
            Image::JellyfinPoster("6c1e2f0a9b".to_owned()).to_string(),
            "poster.6c1e2f0a9b"
        );

        for image in every_image() {
            assert_eq!(
                Image::parse(&image.to_string()),
                Some(image.clone()),
                "{image}"
            );
        }

        for id in [
            "",
            "6c1e2f0a9b",
            "poster.",
            "thumbnail.1",
            "poster.a/b",
            "poster..",
            "Poster.a",
        ] {
            assert_eq!(Image::parse(id), None, "{id}");
        }
    }

    #[test]
    fn takes_an_image_id_of_the_services_and_no_path() {
        for id in ["1700000000.5-abc", "6c1e2f0a9b", "21-755143", "a_b"] {
            assert!(Image::is_service_id(id), "{id}");
        }

        for id in ["", ".", "..", "a/b", "a b", "a%2Fb", "é"] {
            assert!(!Image::is_service_id(id), "{id}");
        }
    }

    #[test]
    fn relays_a_raster_image_whatever_the_case_of_its_type_and_one_of_no_type_as_a_jpeg() {
        let relayed = |content_type: &str| {
            Image::raster(Bytes::from(vec![1, 2]).with_content_type(content_type))
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
