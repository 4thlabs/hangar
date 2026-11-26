//! The routes of the group `Store`: the store's state and its sync, its apps with their filters and counts, installing
//! and uninstalling one, and the template of a new app.

use hangar_api::{
    AppCounts, AppFilter, ErrorCode, NewAppTemplate, StoreApp, StoreApps, StoreServer, StoreStatus,
    StoreSync,
};
use hangar_core::{ComposeCommand, StoreError};
use quoll::{Error, Response, Result};

use super::StoreState;
use super::command_log::CommandLog;
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl StoreState {
    /// What a new app starts from: what Hangar needs to list it, a name, an icon, a service with its container.
    const NEW_APP: &str = "name: My app
x-hangar:
  icon: https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/docker.webp
services:
  my-app:
    image: nginx:latest
    container_name: my-app
    restart: unless-stopped
";

    /// Every app of the store.
    async fn apps(&self) -> Result<Vec<StoreApp>> {
        let apps = self
            .store
            .apps()
            .await
            .map_err(|error| Failure::store(ErrorCode::AppsUnreadable, &error))?;

        Ok(apps.into_iter().map(Self::view).collect())
    }

    /// The app `id` of the store, if the store carries it.
    pub(super) async fn find(&self, id: &str) -> Result<Option<StoreApp>> {
        Ok(self.apps().await?.into_iter().find(|app| app.id == id))
    }

    /// The 404 of an app the store does not carry.
    pub(super) fn unknown(id: &str) -> Error {
        tracing::warn!(app = ?id, "an unknown app was asked for");

        ErrorCode::UnknownApp { app: id.to_owned() }.into()
    }

    /// Installs the app `id`, unless it is already: links it, then seeds the variables its files reference. A 409 while
    /// a compose batch holds it.
    async fn install(&self, id: &str) -> Result<StoreApp> {
        let _claim = self.locks.claim([id])?;
        let _change = self.change().await?;
        let Some(app) = self.find(id).await? else {
            return Err(Self::unknown(id));
        };

        if app.installed {
            return Ok(app);
        }

        let failed = || ErrorCode::InstallFailed {
            app: app.name.clone(),
        };

        self.store
            .install_app(&app.id)
            .await
            .map_err(|error| Failure::store(failed(), &error))?;

        match self.find(&app.id).await? {
            Some(installed) if installed.installed => Ok(installed),
            _ => Err(Failure::logged(failed(), &Unconfirmed)),
        }
    }

    /// Uninstalls the app `id`, unless it is not installed: `docker compose down` first, as once its link is gone its
    /// compose files are out of reach, and what runs an orphan Hangar can no longer manage; then its link.
    ///
    /// An app installed that the store no longer reads, its folder gone, its `compose.yml` or `hangar.yml` broken, goes
    /// by its link alone, as the core's `uninstall_app` does. A 409 while a compose batch holds it, which would bring
    /// back what `down` took down; a batch is refused while this runs.
    async fn uninstall(&self, id: &str) -> Result<StoreApp> {
        let _claim = self.locks.claim([id])?;
        let _change = self.change().await?;
        let app = match self.store.apps().await {
            Ok(apps) => apps.into_iter().find(|app| app.id == id).map(Self::view),
            Err(error @ StoreError::Config { .. }) => {
                tracing::warn!(app = ?id, error = %Failure::chain(&error), "uninstalling by the link alone");
                None
            }
            Err(error) => return Err(Failure::logged(ErrorCode::AppsUnreadable, &error)),
        };

        match app {
            Some(app) if !app.installed => Ok(app),
            Some(app) => self.take_down(app).await,
            None => self.unlink(id).await,
        }
    }

    /// Uninstalls `app`, which the store reads: its link is removed once compose has taken it down, or kept.
    async fn take_down(&self, app: StoreApp) -> Result<StoreApp> {
        let failed = || ErrorCode::UninstallFailed {
            app: app.name.clone(),
        };
        let down = CommandLog::lines("docker compose down", app.id.clone());

        self.compose
            .run(&app.id, ComposeCommand::Down, down)
            .await
            .map_err(|error| Failure::logged(failed(), &error))?;
        self.store
            .uninstall_app(&app.id)
            .await
            .map_err(|error| Failure::logged(failed(), &error))?;

        match self.find(&app.id).await? {
            Some(uninstalled) if !uninstalled.installed => Ok(uninstalled),
            _ => Err(Failure::logged(failed(), &Unconfirmed)),
        }
    }

    /// Uninstalls `id`, which the store no longer reads, by its link: `docker compose down` as far as compose can read
    /// what is left of it, then the link removed all the same, as nothing else would ever remove it. A 404 without one.
    async fn unlink(&self, id: &str) -> Result<StoreApp> {
        let failed = || ErrorCode::UninstallFailed { app: id.to_owned() };
        let is_linked = match self.store.is_linked(id).await {
            Ok(is_linked) => is_linked,
            Err(StoreError::InvalidAppId { .. }) => false,
            Err(error) => return Err(Failure::logged(failed(), &error)),
        };

        if !is_linked {
            return Err(Self::unknown(id));
        }

        let down = CommandLog::lines("docker compose down", id);

        if let Err(error) = self.compose.run(id, ComposeCommand::Down, down).await {
            tracing::warn!(
                app = %id,
                error = %Failure::chain(&error),
                "an app the store no longer reads could not be taken down: its link is removed all the same"
            );
        }

        self.store
            .uninstall_app(id)
            .await
            .map_err(|error| Failure::logged(failed(), &error))?;

        Ok(StoreApp {
            id: id.to_owned(),
            name: id.to_owned(),
            icon: None,
            installed: false,
            swarm_ready: false,
        })
    }

    /// The listing of `all` that `filters` keeps, all of them for none, and how many each filter keeps.
    fn listing(all: Vec<StoreApp>, filters: &[AppFilter]) -> StoreApps {
        let installed = all.iter().filter(|app| app.installed).count();
        let counts = AppCounts {
            installed,
            available: all.len() - installed,
        };
        let apps = all
            .into_iter()
            .filter(|app| filters.is_empty() || filters.contains(&Self::filter(app)))
            .collect();

        StoreApps { apps, counts }
    }

    /// The filter `app` falls under.
    fn filter(app: &StoreApp) -> AppFilter {
        if app.installed {
            AppFilter::Installed
        } else {
            AppFilter::Available
        }
    }

    /// `app` as the page shows it.
    fn view(app: hangar_core::StoreApp) -> StoreApp {
        StoreApp {
            id: app.id,
            name: app.name,
            icon: app.icon,
            installed: app.installed,
            swarm_ready: app.swarm_ready,
        }
    }
}

/// An install or an uninstall that ran, after which the app is not as it should be: another process, the Waku version
/// say, changed it meanwhile.
#[derive(Debug, thiserror::Error)]
#[error("the app is not as the change left it")]
struct Unconfirmed;

impl StoreServer for App {
    async fn status(&self, _: &SignedIn) -> Result<Response<StoreStatus>> {
        let store = &self.store;

        Ok(Response::new(StoreStatus {
            url: store.store.url().to_owned(),
            installed: store.store.is_installed().await,
            sync: store.last_sync(),
        }))
    }

    async fn sync(&self, _: &SignedIn) -> Result<Response<StoreSync>> {
        Ok(Response::new(self.store.start_sync().await))
    }

    async fn apps(&self, _: &SignedIn, filter: Vec<AppFilter>) -> Result<Response<StoreApps>> {
        let all = self.store.apps().await?;

        Ok(Response::new(StoreState::listing(all, &filter)))
    }

    async fn install(&self, _: &SignedIn, id: String) -> Result<Response<StoreApp>> {
        let installed = self.store.install(&id).await;

        // A failure may have linked it all the same.
        self.store.installed_changed();

        Ok(Response::new(installed?))
    }

    async fn uninstall(&self, _: &SignedIn, id: String) -> Result<Response<StoreApp>> {
        let uninstalled = self.store.uninstall(&id).await;

        // A failure may have taken it down, or unlinked it, all the same.
        self.store.installed_changed();

        Ok(Response::new(uninstalled?))
    }

    async fn new_app(&self, _: &SignedIn) -> Result<Response<NewAppTemplate>> {
        Ok(Response::new(NewAppTemplate {
            compose: StoreState::NEW_APP.to_owned(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use hangar_api::{AppFilter, StoreApp};

    use super::StoreState;

    fn app(id: &str, installed: bool) -> StoreApp {
        StoreApp {
            id: id.to_owned(),
            name: id.to_owned(),
            icon: None,
            installed,
            swarm_ready: false,
        }
    }

    fn ids(filters: &[AppFilter]) -> Vec<String> {
        let all = vec![app("alpha", true), app("beta", false), app("gamma", false)];

        StoreState::listing(all, filters)
            .apps
            .into_iter()
            .map(|app| app.id)
            .collect()
    }

    #[test]
    fn keeps_the_apps_of_the_filters_or_all_of_them_for_none() {
        assert_eq!(ids(&[]), ["alpha", "beta", "gamma"]);
        assert_eq!(ids(&[AppFilter::Installed]), ["alpha"]);
        assert_eq!(ids(&[AppFilter::Available]), ["beta", "gamma"]);
        assert_eq!(
            ids(&[AppFilter::Installed, AppFilter::Available]),
            ["alpha", "beta", "gamma"]
        );
    }

    #[test]
    fn counts_every_app_whatever_the_filters() {
        let all = vec![app("alpha", true), app("beta", false), app("gamma", false)];
        let listing = StoreState::listing(all, &[AppFilter::Installed]);

        assert_eq!(listing.counts.installed, 1);
        assert_eq!(listing.counts.available, 2);
    }
}
