//! The id of a store app.

use std::sync::LazyLock;

use regex::Regex;

/// The id of a store app: its folder name under `store/` (`llama.cpp`). No separator, no leading dot, nothing to climb
/// out of a folder with, so that it can name a folder under `store/`, `app-data/` or `app-backups/`.
pub(crate) struct AppId;

impl AppId {
    /// The pattern of an id: lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a digit.
    pub(crate) fn regex() -> &'static Regex {
        static PATTERN: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9._-]*$").expect("the pattern is valid"));

        &PATTERN
    }
}

#[cfg(test)]
mod tests {
    use super::AppId;

    #[test]
    fn takes_a_folder_name_and_nothing_that_climbs_out_of_one() {
        for id in ["jellyfin", "llama.cpp", "sync-in", "0ad", "a_b"] {
            assert!(AppId::regex().is_match(id), "{id}");
        }

        for id in ["", ".hidden", "../etc", "a/b", "Jellyfin", "-app", "café"] {
            assert!(!AppId::regex().is_match(id), "{id}");
        }
    }
}
