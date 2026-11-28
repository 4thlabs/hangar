//! The routes of the group `Services`: each service's parts, read for a placement, and the images they name.

use hangar_api::{JellyfinData, JellyfinRead, ServicesServer};
use http::header::CACHE_CONTROL;
use quoll::{Bytes, Response, Result};

use super::{Declared, Image};
use crate::App;
use crate::auth::SignedIn;

impl ServicesServer for App {
    async fn jellyfin(
        &self,
        _: &SignedIn,
        widget: String,
        read: JellyfinRead,
    ) -> Result<Response<JellyfinData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Jellyfin { at, user } = declared else {
                        return None;
                    };

                    Some((at, user.to_owned()))
                },
                async |locator, user| services.jellyfin.read(&locator, &user, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn image(&self, _: &SignedIn, widget: String, id: String) -> Result<Response<Bytes>> {
        let image = self.services.image(&widget, &id).await?;

        Ok(Response::new(image).header(CACHE_CONTROL, Image::CACHE))
    }
}
