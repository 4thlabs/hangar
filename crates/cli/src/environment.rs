//! The variables the commands read, from the core's [`Environment`]: the process's, else the `.env` of the working
//! directory, as the Node CLI reads them with `dotenv/config`.

use std::collections::BTreeMap;

use hangar_core::{DataDir, Environment};

use crate::failure::Failure;

/// The environment of the commands. Each command needs only what it uses: `HANGAR_DATA_DIR` for the store and
/// compose, and `HANGAR_STORE_URL` for an install.
#[derive(Debug)]
pub(crate) struct Variables {
    environment: Environment,
}

impl Variables {
    /// The process's environment, and the `.env` of the working directory under it. A missing file adds nothing.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Dotenv`] when the file is there but cannot be read.
    pub(crate) fn load() -> Result<Self, Failure> {
        let environment = Environment::load().map_err(Failure::Dotenv)?;

        Ok(Self { environment })
    }

    /// The variables of `.env` that the process's environment does not set, which the children get too.
    pub(crate) fn file_variables(&self) -> &BTreeMap<String, String> {
        self.environment.file_variables()
    }

    /// The data directory, from `HANGAR_DATA_DIR`.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Store`] when the variable is not set, or does not name a usable path.
    pub(crate) fn data_dir(&self) -> Result<DataDir, Failure> {
        Ok(self.environment.data_dir()?)
    }

    /// The git URL of the store, from `HANGAR_STORE_URL`.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::NotSet`] when the variable is not set.
    pub(crate) fn store_url(&self) -> Result<String, Failure> {
        self.environment
            .variable(Environment::STORE_URL)
            .ok_or(Failure::NotSet {
                variable: Environment::STORE_URL,
            })
    }
}
