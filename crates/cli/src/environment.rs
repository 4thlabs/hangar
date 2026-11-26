//! The variables the commands read: from the process's environment, else from the `.env` of the working directory,
//! as the Node CLI reads them with `dotenv/config`.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use hangar_core::{DataDir, Dotenv, StoreError};

use crate::failure::Failure;

/// The environment of the commands: the process's, then what `.env` adds to it, read by dotenv's own rules, values
/// taken as they are written and lines it does not read skipped. Each command needs only what it uses:
/// `HANGAR_DATA_DIR` for the store and compose, and `HANGAR_STORE_URL` for an install.
#[derive(Debug, Default)]
pub(crate) struct Environment {
    /// The variables of `.env` that the process's environment does not set, which the children get too.
    file_variables: BTreeMap<String, String>,
}

impl Environment {
    /// The file read at the start, in the working directory alone, as `dotenv/config` reads it.
    const FILE: &str = ".env";

    /// The git URL of the store.
    const STORE_URL: &str = "HANGAR_STORE_URL";

    /// The process's environment, and the `.env` of the working directory under it. A missing file adds nothing.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Dotenv`] when the file is there but cannot be read.
    pub(crate) fn load() -> Result<Self, Failure> {
        match std::fs::read(Path::new(Self::FILE)) {
            // Decoded as Node decodes it, a byte that is not UTF-8 replaced rather than failing the file.
            Ok(bytes) => Ok(Self::with_file(&String::from_utf8_lossy(&bytes))),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(Failure::Dotenv(error)),
        }
    }

    /// The process's environment, and the variables of `source` under it.
    fn with_file(source: &str) -> Self {
        let file_variables = Dotenv::parse(source)
            .into_iter()
            .filter(|(key, _)| std::env::var_os(key).is_none())
            .collect();

        Self { file_variables }
    }

    /// The variables of `.env` that the process's environment does not set: those it passes on to the children, as
    /// `dotenv/config` does by setting them in the Node CLI's environment.
    pub(crate) fn file_variables(&self) -> &BTreeMap<String, String> {
        &self.file_variables
    }

    /// The data directory, from `HANGAR_DATA_DIR`.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Store`] when the variable is not set, or does not name a usable path.
    pub(crate) fn data_dir(&self) -> Result<DataDir, Failure> {
        let Some(root) = self.variable(DataDir::VARIABLE) else {
            return Err(StoreError::DataDirNotSet.into());
        };

        Ok(DataDir::new(root)?)
    }

    /// The git URL of the store, from `HANGAR_STORE_URL`.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::NotSet`] when the variable is not set.
    pub(crate) fn store_url(&self) -> Result<String, Failure> {
        self.variable(Self::STORE_URL).ok_or(Failure::NotSet {
            variable: Self::STORE_URL,
        })
    }

    /// A variable, from the process's environment, else from `.env`; one that is empty, or not Unicode, is not set.
    fn variable(&self, name: &str) -> Option<String> {
        let value = match std::env::var(name) {
            Ok(value) => value,
            Err(_) => self.file_variables.get(name).cloned().unwrap_or_default(),
        };

        Some(value).filter(|value| !value.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::Environment;

    #[test]
    fn takes_the_values_as_dotenv_does_and_skips_the_lines_it_does_not_read() {
        let environment = Environment::with_file(
            "BROKEN LINE\n\
             HANGAR_CLI_TEST_HASH=\"admin:$apr1$abc\"\n\
             HANGAR_CLI_TEST_PASSWORD=pa$word\n\
             HANGAR_CLI_TEST_QUOTED='single $HOME # kept'\n",
        );
        let value = |name: &str| environment.file_variables().get(name).map(String::as_str);

        assert_eq!(value("HANGAR_CLI_TEST_HASH"), Some("admin:$apr1$abc"));
        assert_eq!(value("HANGAR_CLI_TEST_PASSWORD"), Some("pa$word"));
        assert_eq!(value("HANGAR_CLI_TEST_QUOTED"), Some("single $HOME # kept"));
        assert_eq!(environment.file_variables().len(), 3);
    }

    #[test]
    fn leaves_what_the_environment_sets_to_the_environment() {
        let environment = Environment::with_file("PATH=/nowhere\n");

        assert!(environment.file_variables().is_empty());
    }
}
