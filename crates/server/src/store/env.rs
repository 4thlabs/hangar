//! The routes of the group `Env`: `.env.global`, read, and saved merged into what is on disk.

use std::collections::BTreeMap;

use hangar_api::{EnvChanges, EnvServer, ErrorCode, GlobalVariables};
use hangar_core::StoreError;
use http::header::CACHE_CONTROL;
use quoll::{Response, Result};

use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

/// What the browser may put in `.env.global`. Every container reads the file: a line break in a value would add a
/// variable. The names are the core's to check, against the file: a new one must be one compose takes, and one the
/// file holds already may be set or removed whatever it is.
#[derive(Debug)]
struct EnvCheck;

impl EnvCheck {
    /// Refuses `changes` that would not be written as they are asked.
    fn check(changes: &EnvChanges) -> Result<()> {
        if let Some(name) = changes
            .remove
            .iter()
            .find(|name| changes.updates.contains_key(*name))
        {
            return Err(ErrorCode::UpdatedAndRemoved { name: name.clone() }.into());
        }

        if let Some((name, _)) = changes
            .updates
            .iter()
            .find(|(_, value)| value.contains(['\r', '\n']))
        {
            return Err(ErrorCode::LineBreak { name: name.clone() }.into());
        }

        Ok(())
    }
}

impl App {
    /// The variables as the page reads them, never cached: they are secrets.
    fn variables(variables: BTreeMap<String, String>) -> Response<GlobalVariables> {
        Response::new(GlobalVariables { variables }).header(CACHE_CONTROL, "no-store")
    }
}

impl EnvServer for App {
    async fn read(&self, _: &SignedIn) -> Result<Response<GlobalVariables>> {
        let variables = self
            .store
            .store
            .env()
            .read()
            .await
            .map_err(|error| Failure::logged(ErrorCode::EnvUnreadable, &error))?;

        Ok(Self::variables(variables))
    }

    async fn save(&self, _: &SignedIn, changes: EnvChanges) -> Result<Response<GlobalVariables>> {
        EnvCheck::check(&changes)?;

        let remove: Vec<&str> = changes.remove.iter().map(String::as_str).collect();
        let written = self.store.store.env().write(changes.updates, &remove).await;

        match written {
            Ok(variables) => Ok(Self::variables(variables)),
            Err(StoreError::UnwritableValue { key }) => {
                Err(ErrorCode::UnwritableValue { name: key }.into())
            }
            Err(StoreError::InvalidVariable { key }) => {
                tracing::warn!(name = ?key, "a global variable of an invalid name was refused");

                Err(ErrorCode::InvalidVariableName { name: key }.into())
            }
            Err(error) => Err(Failure::logged(ErrorCode::EnvSaveFailed, &error)),
        }
    }
}
