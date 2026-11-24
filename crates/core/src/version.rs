//! The version of the core.

/// The version of the core, which the `hangar` binary prints for `--version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::VERSION;

    #[test]
    fn version_is_the_package_version() {
        let release = format!(
            "{}.{}.{}",
            env!("CARGO_PKG_VERSION_MAJOR"),
            env!("CARGO_PKG_VERSION_MINOR"),
            env!("CARGO_PKG_VERSION_PATCH")
        );
        let pre_release = env!("CARGO_PKG_VERSION_PRE");
        let expected = if pre_release.is_empty() {
            release
        } else {
            format!("{release}-{pre_release}")
        };

        assert_eq!(VERSION, expected);
    }
}
