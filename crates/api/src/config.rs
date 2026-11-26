//! The store's `hangar.yml`, read and saved as it is written.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `hangar.yml` as it is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ConfigSource {
    /// The file, empty when the store ships none.
    pub source: String,
}

quoll::group! {
    /// The store's configuration, `config/hangar.yml`.
    #[auth(crate::Session)]
    pub group Config {
        /// The file as it is written.
        GET "/config" => read() -> ConfigSource;

        /// Checks the file, then writes it as it is and links the apps and shared files it lists. A file that is not
        /// valid is a 400 that names the field at fault, and is not written; a store not cloned yet is a 409.
        PUT "/config" => save(config: &ConfigSource);
    }
}
