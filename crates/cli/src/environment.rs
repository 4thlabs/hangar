//! The variables the commands read: from the process's environment, else from the `.env` of the working directory,
//! as the Node CLI reads them with `dotenv/config`.

use std::path::Path;

use hangar_core::DataDir;

use crate::failure::Failure;

/// The environment of the commands. Each needs only what it uses: `HANGAR_DATA_DIR` for the store and compose, and
/// `HANGAR_STORE_URL` for an install.
#[derive(Debug)]
pub(crate) struct Environment;

impl Environment {
    /// The file read at the start, in the working directory alone, as `dotenv/config` reads it.
    const FILE: &str = ".env";

    /// The git URL of the store.
    const STORE_URL: &str = "HANGAR_STORE_URL";

    /// Sets the variables of `.env` that the process's environment does not set already, which the children inherit
    /// too, as the Node CLI's do. A missing file sets nothing.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Dotenv`] when the file is there but cannot be read or parsed.
    pub(crate) fn load() -> Result<(), Failure> {
        match dotenvy::from_path(Path::new(Self::FILE)) {
            Ok(()) => Ok(()),
            Err(error) if error.not_found() => Ok(()),
            Err(error) => Err(Failure::Dotenv(error)),
        }
    }

    /// The data directory, from `HANGAR_DATA_DIR`.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Store`] when the variable is not set or does not name a usable path.
    pub(crate) fn data_dir() -> Result<DataDir, Failure> {
        Ok(DataDir::from_env()?)
    }

    /// The git URL of the store, from `HANGAR_STORE_URL`.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::NotSet`] when the variable is not set, empty or not Unicode.
    pub(crate) fn store_url() -> Result<String, Failure> {
        let url = std::env::var(Self::STORE_URL).unwrap_or_default();

        if url.is_empty() {
            return Err(Failure::NotSet {
                variable: Self::STORE_URL,
            });
        }

        Ok(url)
    }
}
