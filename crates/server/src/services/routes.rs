//! The routes of the group `Services`: each service's parts, read for a placement, and the images they name.

use hangar_api::{
    ArcaneData, ArcaneRead, BackrestData, BackrestRead, BeszelData, BeszelRead, FinnhubData,
    FinnhubRead, ForgejoData, ForgejoRead, FrigateData, FrigateRead, GithubData, GithubRead,
    GluetunData, GluetunRead, JellyfinData, JellyfinRead, MinifluxData, MinifluxRead,
    ServicesServer, TcgCollectorData, TcgCollectorRead,
};
use http::header::CACHE_CONTROL;
use quoll::{Bytes, Response, Result};

use super::{Declared, Image};
use crate::App;
use crate::auth::SignedIn;

impl ServicesServer for App {
    async fn arcane(
        &self,
        _: &SignedIn,
        widget: String,
        read: ArcaneRead,
    ) -> Result<Response<ArcaneData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Arcane(_) = declared else {
                        return None;
                    };

                    Some(())
                },
                async |locator, ()| services.arcane.read(&locator, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn backrest(
        &self,
        _: &SignedIn,
        widget: String,
        read: BackrestRead,
    ) -> Result<Response<BackrestData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Backrest(_) = declared else {
                        return None;
                    };

                    Some(())
                },
                async |locator, ()| services.backrest.read(&locator, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn beszel(
        &self,
        _: &SignedIn,
        widget: String,
        read: BeszelRead,
    ) -> Result<Response<BeszelData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Beszel(_) = declared else {
                        return None;
                    };

                    Some(())
                },
                async |locator, ()| services.beszel.read(&locator, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn finnhub(
        &self,
        _: &SignedIn,
        widget: String,
        read: FinnhubRead,
    ) -> Result<Response<FinnhubData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Finnhub { tickers, .. } = declared else {
                        return None;
                    };

                    Some(tickers.to_vec())
                },
                async |locator, needs| services.finnhub.read(&locator, &needs, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn forgejo(
        &self,
        _: &SignedIn,
        widget: String,
        read: ForgejoRead,
    ) -> Result<Response<ForgejoData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Forgejo { owners, .. } = declared else {
                        return None;
                    };

                    Some(owners.map(<[String]>::to_vec))
                },
                async |locator, needs| {
                    services
                        .forgejo
                        .read(&locator, needs.as_deref(), read)
                        .await
                },
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn frigate(
        &self,
        _: &SignedIn,
        widget: String,
        read: FrigateRead,
    ) -> Result<Response<FrigateData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Frigate(_) = declared else {
                        return None;
                    };

                    Some(())
                },
                async |locator, ()| services.frigate.read(&locator, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn github(
        &self,
        _: &SignedIn,
        widget: String,
        read: GithubRead,
    ) -> Result<Response<GithubData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Github { repositories, .. } = declared else {
                        return None;
                    };

                    Some(repositories.to_vec())
                },
                async |locator, needs| services.github.read(&locator, &needs, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn gluetun(
        &self,
        _: &SignedIn,
        widget: String,
        read: GluetunRead,
    ) -> Result<Response<GluetunData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Gluetun(_) = declared else {
                        return None;
                    };

                    Some(())
                },
                async |locator, ()| services.gluetun.read(&locator, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

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
                    let Declared::Jellyfin { user, .. } = declared else {
                        return None;
                    };

                    Some((*user).to_owned())
                },
                async |locator, needs| services.jellyfin.read(&locator, &needs, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn miniflux(
        &self,
        _: &SignedIn,
        widget: String,
        read: MinifluxRead,
    ) -> Result<Response<MinifluxData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::Miniflux(_) = declared else {
                        return None;
                    };

                    Some(())
                },
                async |locator, ()| services.miniflux.read(&locator, read).await,
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn tcg_collector(
        &self,
        _: &SignedIn,
        widget: String,
        read: TcgCollectorRead,
    ) -> Result<Response<TcgCollectorData>> {
        let services = &self.services;
        let data = services
            .read(
                &widget,
                |declared| {
                    let Declared::TcgCollector { days, cards, .. } = declared else {
                        return None;
                    };

                    Some((*days, cards.to_vec()))
                },
                async |locator, needs| {
                    services
                        .tcg_collector
                        .read(&locator, needs.0, &needs.1, read)
                        .await
                },
            )
            .await?;

        Ok(Response::new(data))
    }

    async fn image(&self, _: &SignedIn, widget: String, id: String) -> Result<Response<Bytes>> {
        let image = self.services.image(&widget, &id).await?;

        Ok(Response::new(image).header(CACHE_CONTROL, Image::CACHE))
    }
}
