//! The routes of the group `Services`: each service's parts, read for a placement, and the images they name.

use hangar_api::{JellyfinData, JellyfinRead, ServicesServer};
use http::header::CACHE_CONTROL;
use quoll::{Bytes, Response, Result};

use super::{Declared, Image, ServicesState};
use crate::App;
use crate::auth::SignedIn;

impl ServicesState {
    /// What `read` asks of the Jellyfin of the widget placed as `key`.
    async fn jellyfin(&self, key: &str, read: JellyfinRead) -> Result<JellyfinData> {
        let placement = self.placement(key).await?;
        let declared = Declared::of(&placement.widget.kind);
        let Declared::Jellyfin { at, user } = declared else {
            return Err(Self::unknown(key));
        };
        let service = self
            .service(&at)
            .await
            .map_err(|error| Self::unavailable(&placement, &error))?;

        self.jellyfin
            .read(&service, declared.policy(), user, read)
            .await
            .map_err(|error| Self::unavailable(&placement, &error))
    }
}

impl ServicesServer for App {
    async fn jellyfin(
        &self,
        _: &SignedIn,
        widget: String,
        read: JellyfinRead,
    ) -> Result<Response<JellyfinData>> {
        Ok(Response::new(self.services.jellyfin(&widget, read).await?))
    }

    async fn image(&self, _: &SignedIn, widget: String, id: String) -> Result<Response<Bytes>> {
        let image = self.services.image(&widget, &id).await?;

        Ok(Response::new(image).header(CACHE_CONTROL, Image::CACHE))
    }
}
