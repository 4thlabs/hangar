//! The version of the core.

/// The version of the core, which the `hangar` binary prints for `--version`: that of the release it was built for,
/// as CI passes its tag in `HANGAR_VERSION`, its `v` left out; the workspace's with `-dev` for any other build.
pub const VERSION: &str = Version::of(option_env!("HANGAR_VERSION"));

/// How a build's version is read off the tag it was given.
struct Version;

impl Version {
    /// The version of a build of the workspace that is no release.
    const DEVELOPMENT: &str = concat!(env!("CARGO_PKG_VERSION"), "-dev");

    /// The version `tag` names, `v1.3.0` as `1.3.0`; [`Version::DEVELOPMENT`] with no tag, or an empty one, as CI
    /// passes on a build that is not a tag's.
    const fn of(tag: Option<&'static str>) -> &'static str {
        let Some(tag) = tag else {
            return Self::DEVELOPMENT;
        };

        match tag.as_bytes() {
            [] => Self::DEVELOPMENT,
            [b'v', ..] => tag.split_at(1).1,
            _ => tag,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Version;

    #[test]
    fn is_the_tag_of_the_release_without_its_v() {
        assert_eq!(Version::of(Some("v1.3.0")), "1.3.0");
        assert_eq!(Version::of(Some("1.3.0-rc.1")), "1.3.0-rc.1");
    }

    #[test]
    fn is_the_workspace_version_for_development_without_a_tag() {
        let development = format!("{}-dev", env!("CARGO_PKG_VERSION"));

        assert_eq!(Version::of(None), development);
        assert_eq!(Version::of(Some("")), development);
    }
}
