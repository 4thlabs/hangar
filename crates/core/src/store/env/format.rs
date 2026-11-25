//! `.env.global` as the Waku version writes it: a header, the time of the write, then the variables sorted, each
//! quoted only when it must be for dotenv to read it back the same.

use std::collections::BTreeMap;

use super::Dotenv;
use crate::store::StoreError;

/// The format of `.env.global`.
pub(super) struct EnvFormat;

impl EnvFormat {
    /// The head of the file, before the time of its last write.
    const HEADER: &str =
        "# Global Environment Variables\n# These variables are available to all projects\n";

    /// The file holding `variables`, written at `now`.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::UnwritableValue`] for a value that no quoting writes so that dotenv reads it back the
    /// same.
    pub(super) fn serialize(
        variables: &BTreeMap<String, String>,
        now: &jiff::Timestamp,
    ) -> Result<String, StoreError> {
        let lines = variables
            .iter()
            .map(|(key, value)| {
                Self::line(key, value)
                    .ok_or_else(|| StoreError::UnwritableValue { key: key.clone() })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let file = format!(
            "{}# Last updated: {}\n\n{}\n",
            Self::HEADER,
            Self::timestamp(now),
            lines.join("\n")
        );

        // Each line reads back alone; the whole file is read back too, so that no line ever runs into the next.
        let read_back = Dotenv::parse(&file);
        let changed = variables
            .iter()
            .find(|(key, value)| read_back.get(*key) != Some(*value))
            .map(|(key, _)| key)
            .or_else(|| read_back.keys().find(|key| !variables.contains_key(*key)));

        if let Some(key) = changed {
            return Err(StoreError::UnwritableValue { key: key.clone() });
        }

        Ok(file)
    }

    /// `now` as JavaScript's `toISOString` writes it: UTC, to the millisecond.
    pub(super) fn timestamp(now: &jiff::Timestamp) -> String {
        format!("{now:.3}")
    }

    /// The line of `key`: bare as the Waku version writes it, else the first quoting that dotenv reads back as
    /// `value`, double quotes with `\n` escaped first. A value that starts with a quote is never bare: dotenv would
    /// read it up to the same quote on a line below, `A="start` swallowing `B=end"`. Each is checked with the parser rather than reasoned about, as
    /// dotenv's rules are many: a `#` starts a comment, the ends are trimmed, `\n` expands in double quotes only.
    fn line(key: &str, value: &str) -> Option<String> {
        let escaped = value.replace('\n', r"\n").replace('\r', r"\r");
        let opens_a_quote = value.starts_with(['\'', '"', '`']);
        let bare =
            (!opens_a_quote && !Self::has_blank_ends(value)).then(|| format!("{key}={value}"));
        let quoted = [
            format!("{key}=\"{escaped}\""),
            format!("{key}='{value}'"),
            format!("{key}=`{value}`"),
        ];

        bare.into_iter().chain(quoted).find(|line| {
            let parsed = Dotenv::parse(line);

            parsed.len() == 1 && parsed.get(key).map(String::as_str) == Some(value)
        })
    }

    /// Whether `value` starts or ends with a blank that dotenv trims, or that Rust would: such a value is quoted,
    /// never written bare.
    fn has_blank_ends(value: &str) -> bool {
        let is_blank = |character: char| character.is_whitespace() || Dotenv::is_space(character);

        value.starts_with(is_blank) || value.ends_with(is_blank)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{Dotenv, EnvFormat};
    use crate::store::StoreError;

    /// What `variables` come back as, written then read.
    fn round_trip(variables: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        let file = EnvFormat::serialize(variables, &jiff::Timestamp::now())
            .expect("the values are writable");

        Dotenv::parse(&file)
    }

    #[test]
    fn writes_a_plain_value_bare_as_the_waku_version_does() {
        assert_eq!(
            EnvFormat::line("DOMAIN", "example.com").as_deref(),
            Some("DOMAIN=example.com")
        );
        assert_eq!(EnvFormat::line("EMPTY", "").as_deref(), Some("EMPTY="));
        assert_eq!(
            EnvFormat::line("URL", "a=b?c").as_deref(),
            Some("URL=a=b?c")
        );
    }

    #[test]
    fn reads_back_every_value_exactly_as_it_was_written() {
        let values = [
            "p#ss w0rd ",
            "#starts with a comment",
            "  both ends  ",
            "\tleading tab",
            "say \"hi\"",
            "it's",
            "`ticks`",
            "'single'",
            "\"double\"",
            "line\nbreak",
            "carriage\rreturn",
            "literal \\n stays",
            "a=b=c",
            "",
            "ends with a backslash \\",
            "\u{feff}bom",
            "mixed 'single' \"double\" # and \n newline",
        ];
        let variables: BTreeMap<String, String> = values
            .iter()
            .enumerate()
            .map(|(index, value)| (format!("KEY_{index:02}"), (*value).to_owned()))
            .collect();

        assert_eq!(round_trip(&variables), variables);
        assert_eq!(
            round_trip(&round_trip(&variables)),
            variables,
            "a second write changes nothing"
        );
    }

    #[test]
    fn keeps_apart_two_values_with_quotes_that_would_pair_across_lines() {
        let variables = BTreeMap::from([
            ("A".to_owned(), "\"start".to_owned()),
            ("B".to_owned(), "end\"".to_owned()),
            ("C".to_owned(), "'".to_owned()),
            ("D".to_owned(), "it's".to_owned()),
            ("E".to_owned(), "`".to_owned()),
            ("F".to_owned(), "x`".to_owned()),
        ]);

        assert_eq!(round_trip(&variables), variables);
    }

    #[test]
    fn quotes_a_value_with_a_newline_on_one_line() {
        let line = EnvFormat::line("KEY", "a\nINJECTED=1").expect("the value is writable");

        assert_eq!(line, r#"KEY="a\nINJECTED=1""#);
    }

    #[test]
    fn refuses_a_value_that_no_quoting_reads_back() {
        let variables = BTreeMap::from([("KEY".to_owned(), "'`\" #\nx".to_owned())]);
        let error = EnvFormat::serialize(&variables, &jiff::Timestamp::now())
            .expect_err("nothing quotes it");

        assert!(matches!(error, StoreError::UnwritableValue { key } if key == "KEY"));
    }
}
