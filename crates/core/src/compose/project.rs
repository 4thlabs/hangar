//! The name of a compose project.

use std::sync::LazyLock;

use regex::Regex;

/// The name `docker compose -p` takes, which Hangar gives an app's project: its id, so that its containers keep
/// matching the installed app whatever its display name says.
pub(crate) struct ProjectName;

impl ProjectName {
    /// Whether compose takes `name` as a project: lowercase letters, digits, `_` and `-`, starting with a letter or a
    /// digit, as the Waku version checks it. Nothing in it climbs out of `app-installed/`.
    pub(crate) fn is_valid(name: &str) -> bool {
        static PATTERN: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9_-]*$").expect("the pattern is valid"));

        PATTERN.is_match(name)
    }
}

#[cfg(test)]
mod tests {
    use super::ProjectName;

    #[test]
    fn takes_what_compose_takes_and_nothing_that_climbs_out_of_a_folder() {
        for name in ["jellyfin", "sync-in", "0ad", "a_b"] {
            assert!(ProjectName::is_valid(name), "{name}");
        }

        for name in [
            "",
            "llama.cpp",
            "..",
            "../etc",
            "a/b",
            "Jellyfin",
            "-app",
            "_app",
        ] {
            assert!(!ProjectName::is_valid(name), "{name}");
        }
    }
}
