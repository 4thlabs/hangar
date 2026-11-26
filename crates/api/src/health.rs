//! Whether the server is up, for the healthcheck of its image.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What the health route answers: the server is up, at this version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ServerHealth {
    /// The version of the server, as its crates give it.
    pub version: String,
}

quoll::group! {
    /// The server's health, which needs no session.
    pub group Health {
        /// Answers 200 while the server serves: the healthcheck of the image.
        GET "/health" => check() -> ServerHealth;
    }
}
