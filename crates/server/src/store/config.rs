//! The routes of the group `Config`: the store's `hangar.yml`, read and saved as it is written.

use hangar_api::{ConfigServer, ConfigSource, ErrorCode};
use hangar_core::StoreError;
use quoll::{Response, Result};

use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl ConfigServer for App {
    async fn read(&self, _: &SignedIn) -> Result<Response<ConfigSource>> {
        let source = self
            .store
            .store
            .config_source()
            .await
            .map_err(|error| Failure::logged(ErrorCode::ConfigUnreadable, &error))?;

        Ok(Response::new(ConfigSource { source }))
    }

    async fn save(&self, _: &SignedIn, config: ConfigSource) -> Result<Response<()>> {
        let _change = self.store.change().await?;

        match self.store.store.save_config(&config.source).await {
            Ok(_) => Ok(Response::new(())),
            // The user's to fix: the field at fault, as the editor shows it under the file.
            Err(StoreError::Config { source, .. }) => Err(Failure::config(&source).into()),
            Err(StoreError::NotInstalled) => Err(ErrorCode::StoreNotInstalled.into()),
            Err(error) => Err(Failure::logged(ErrorCode::ConfigSaveFailed, &error)),
        }
    }
}
