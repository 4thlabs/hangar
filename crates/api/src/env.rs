//! `.env.global`, the variables every stack is composed with, read and saved merged into what is on disk.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The variables of `.env.global`, by name. Their values are secrets as often as not: the answer is never cached.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct GlobalVariables {
    /// Each variable's value, sorted by name.
    pub variables: BTreeMap<String, String>,
}

impl std::fmt::Debug for GlobalVariables {
    /// The names alone: the values are secrets.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GlobalVariables")
            .field("variables", &self.variables.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// What a save changes in `.env.global`: the variables it sets, and the ones it removes, the only way one is lost.
#[derive(Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct EnvChanges {
    /// The variables to set, by name: added, or their value replaced.
    pub updates: BTreeMap<String, String>,
    /// The variables to remove.
    #[serde(default)]
    pub remove: Vec<String>,
}

impl std::fmt::Debug for EnvChanges {
    /// The names alone: the values are secrets.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EnvChanges")
            .field("updates", &self.updates.keys().collect::<Vec<_>>())
            .field("remove", &self.remove)
            .finish()
    }
}

quoll::group! {
    /// The global environment, `.env.global`, which every compose call reads.
    #[auth(crate::Session)]
    pub group Env {
        /// The variables on disk; none before the file exists.
        GET "/env" => read() -> GlobalVariables;

        /// Merges the changes into the file as it is on disk now, so that a variable added by hand meanwhile is kept,
        /// after a copy of it aside, `.env.global.<time>.bak`; and answers the variables written. A name compose does
        /// not take, or a value with a line break, is a 400, and nothing is written.
        PUT "/env" => save(changes: &EnvChanges) -> GlobalVariables;
    }
}
