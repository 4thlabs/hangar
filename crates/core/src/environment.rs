//! The variables Hangar reads: from the process's environment, else from the `.env` of the working directory, as the
//! Waku version and the Node CLI read them with `dotenv/config`.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use crate::{DataDir, Dotenv, StoreError};

/// The environment of the binary and of the server: the process's, then what `.env` adds to it, read by dotenv's own
/// rules, values taken as they are written and lines it does not read skipped. A variable that is empty, or not
/// Unicode, is not set.
///
/// ```
/// use hangar_core::Environment;
///
/// let environment = Environment::with_file("HANGAR_DOC_EXAMPLE=on\nHANGAR_DOC_EMPTY=\n");
///
/// assert_eq!(environment.variable("HANGAR_DOC_EXAMPLE").as_deref(), Some("on"));
/// assert_eq!(environment.variable("HANGAR_DOC_EMPTY"), None);
/// ```
#[derive(Debug, Clone, Default)]
pub struct Environment {
    /// The variables of `.env` that the process's environment does not set, which the children get too.
    file_variables: BTreeMap<String, String>,
}

impl Environment {
    /// The file read at the start, in the working directory alone, as `dotenv/config` reads it.
    pub const FILE: &str = ".env";

    /// The variable that names the git URL of the store.
    pub const STORE_URL: &str = "HANGAR_STORE_URL";

    /// The process's environment, and the `.env` of the working directory under it. A missing file adds nothing.
    ///
    /// # Errors
    ///
    /// Returns the error of the read when the file is there but cannot be read.
    pub fn load() -> io::Result<Self> {
        match std::fs::read(Path::new(Self::FILE)) {
            // Decoded as Node decodes it, a byte that is not UTF-8 replaced rather than failing the file.
            Ok(bytes) => Ok(Self::with_file(&String::from_utf8_lossy(&bytes))),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error),
        }
    }

    /// The process's environment, and the variables of `source`, a `.env` file's content, under it.
    pub fn with_file(source: &str) -> Self {
        let file_variables = Dotenv::parse(source)
            .into_iter()
            .filter(|(key, _)| std::env::var_os(key).is_none())
            .collect();

        Self { file_variables }
    }

    /// The variables of `.env` that the process's environment does not set: those to pass on to the children, as
    /// `dotenv/config` does by setting them in the Node process's environment.
    pub fn file_variables(&self) -> &BTreeMap<String, String> {
        &self.file_variables
    }

    /// A variable, from the process's environment, else from `.env`; one that is empty, or not Unicode, is not set.
    pub fn variable(&self, name: &str) -> Option<String> {
        let value = match std::env::var(name) {
            Ok(value) => value,
            Err(_) => self.file_variables.get(name).cloned().unwrap_or_default(),
        };

        Some(value).filter(|value| !value.is_empty())
    }

    /// The data directory, from `HANGAR_DATA_DIR`.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DataDirNotSet`] when the variable is not set, and the errors of [`DataDir::new`] when it
    /// does not name a usable path.
    pub fn data_dir(&self) -> Result<DataDir, StoreError> {
        let Some(root) = self.variable(DataDir::VARIABLE) else {
            return Err(StoreError::DataDirNotSet);
        };

        DataDir::new(root)
    }
}

#[cfg(test)]
mod tests {
    use super::Environment;

    #[test]
    fn takes_the_values_as_dotenv_does_and_skips_the_lines_it_does_not_read() {
        let environment = Environment::with_file(
            "BROKEN LINE\n\
             HANGAR_CORE_TEST_HASH=\"admin:$apr1$abc\"\n\
             HANGAR_CORE_TEST_PASSWORD=pa$word\n\
             HANGAR_CORE_TEST_QUOTED='single $HOME # kept'\n",
        );
        let value = |name: &str| environment.file_variables().get(name).map(String::as_str);

        assert_eq!(value("HANGAR_CORE_TEST_HASH"), Some("admin:$apr1$abc"));
        assert_eq!(value("HANGAR_CORE_TEST_PASSWORD"), Some("pa$word"));
        assert_eq!(
            value("HANGAR_CORE_TEST_QUOTED"),
            Some("single $HOME # kept")
        );
        assert_eq!(environment.file_variables().len(), 3);
    }

    #[test]
    fn leaves_what_the_environment_sets_to_the_environment() {
        let environment = Environment::with_file("PATH=/nowhere\n");

        assert!(environment.file_variables().is_empty());
    }

    #[test]
    fn reads_an_empty_variable_as_not_set() {
        let environment = Environment::with_file("HANGAR_CORE_TEST_EMPTY=\n");

        assert_eq!(environment.variable("HANGAR_CORE_TEST_EMPTY"), None);
    }
}
