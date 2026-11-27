//! The names of the archives: the time each was started at, as the Waku version writes them.

use std::sync::LazyLock;

use regex::Regex;

/// An archive's name, without its extension: the UTC time its backup started at, to the millisecond, with no `:`, so
/// that the name stays a valid file name everywhere, `2026-10-18T03-30-00-000Z`. In name order, the archives are in
/// time order.
pub(super) struct ArchiveName;

impl ArchiveName {
    /// The extension of an archive.
    pub(super) const EXTENSION: &str = ".zip";

    /// The extension of an archive being written: renamed once complete, so that a listing never offers a cut one.
    pub(super) const PARTIAL_EXTENSION: &str = ".zip.partial";

    /// Whether `name` is an archive's.
    pub(super) fn is_valid(name: &str) -> bool {
        static PATTERN: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z$")
                .expect("the pattern is valid")
        });

        PATTERN.is_match(name)
    }

    /// The name of an archive started at `time`.
    pub(super) fn of(time: jiff::Timestamp) -> String {
        let utc = time.to_zoned(jiff::tz::TimeZone::UTC);

        format!(
            "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}-{:03}Z",
            utc.year(),
            utc.month(),
            utc.day(),
            utc.hour(),
            utc.minute(),
            utc.second(),
            utc.millisecond()
        )
    }

    /// The time `name`, an archive's, stands for, in RFC 3339: `2026-10-18T03:30:00.000Z`.
    pub(super) fn created_at(name: &str) -> String {
        let (date, time) = name.split_once('T').unwrap_or((name, ""));
        let mut parts = time.trim_end_matches('Z').split('-');
        let mut part = || parts.next().unwrap_or("00");

        format!("{date}T{}:{}:{}.{}Z", part(), part(), part(), part())
    }
}

#[cfg(test)]
mod tests {
    use super::ArchiveName;

    #[test]
    fn names_an_archive_after_its_time_in_utc_to_the_millisecond() {
        let time: jiff::Timestamp = "2026-10-18T05:30:00.042+02:00".parse().expect("a time");
        let name = ArchiveName::of(time);

        assert_eq!(name, "2026-10-18T03-30-00-042Z");
        assert!(ArchiveName::is_valid(&name));
        assert_eq!(ArchiveName::created_at(&name), "2026-10-18T03:30:00.042Z");
    }

    #[test]
    fn takes_no_other_name_for_an_archive() {
        for name in [
            "",
            "2026-10-18T03-30-00Z",
            "2026-10-18T03:30:00.000Z",
            "../2026-10-18T03-30-00-000Z",
            "2026-10-18T03-30-00-000Z.zip",
            "٢٠٢٦-10-18T03-30-00-000Z",
        ] {
            assert!(!ArchiveName::is_valid(name), "{name}");
        }
    }
}
