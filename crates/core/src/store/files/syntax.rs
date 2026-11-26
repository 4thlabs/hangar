//! The check of an app's file before it is written, by its extension: its syntax alone, never what it means. The
//! compose files are not checked here: Docker checks them, which takes the runner.

use std::collections::HashSet;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use serde::Deserialize;
use serde_norway::Value;

use crate::store::{Dotenv, StoreError};

/// The last line of a quoted value over several lines: its text, the closing quote, then blanks and a comment, as
/// dotenv reads them after a value. The text runs to the last quote that only those follow.
static CLOSING_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^(.*)["'`]\s*(?:#.*)?$"#).expect("the pattern is valid"));

/// The syntax check of an app's file.
pub(super) struct FileSyntax;

impl FileSyntax {
    /// Checks `source`, the new text of `file`, as the file's own extension says, not that of a symlink to it: `.yml`
    /// and `.yaml` as YAML, `.env` as dotenv. A file of any other extension passes as it is. `path`, the path it was
    /// asked by, is the one the error names.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidFile`], with what is wrong, when `source` does not parse.
    pub(super) fn check(path: &str, file: &Path, source: &str) -> Result<(), StoreError> {
        let name = file
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default();
        let reason = if name.ends_with(".yml") || name.ends_with(".yaml") {
            Self::yaml(source)
        } else if name.ends_with(".env") {
            Self::env(source)
        } else {
            None
        };

        match reason {
            Some(reason) => Err(StoreError::InvalidFile {
                path: path.to_owned(),
                reason,
            }),
            None => Ok(()),
        }
    }

    /// What is wrong with `source` as YAML: several documents, `---`, and local tags, as Home Assistant's
    /// `!secret db_password` or `!include automations.yaml`, are valid, as js-yaml's `loadAll` reads them with any tag.
    fn yaml(source: &str) -> Option<String> {
        for document in serde_norway::Deserializer::from_str(source) {
            let mut value = match Value::deserialize(document) {
                Ok(value) => value,
                Err(error) => return Some(error.to_string()),
            };

            if let Err(error) = value.apply_merge() {
                return Some(error.to_string());
            }
        }

        None
    }

    /// What is wrong with `source` as dotenv. dotenv never refuses a file: it skips every line it does not read, so a
    /// typo drops a variable without a word. Each line must then be blank, a comment, a variable, or one of the lines
    /// that dotenv took into a quoted value over several lines, the last with its quote.
    fn env(source: &str) -> Option<String> {
        let values = Dotenv::parse(source);
        let value_lines: HashSet<&str> = values
            .values()
            .filter(|value| value.contains('\n'))
            .flat_map(|value| value.split('\n'))
            .collect();

        for (index, line) in source.split('\n').enumerate() {
            let line = line.strip_suffix('\r').unwrap_or(line);
            let trimmed = line.trim_matches(Dotenv::is_space);
            let is_blank_or_comment = trimmed.is_empty() || trimmed.starts_with('#');
            let is_declaration = !Dotenv::parse(line).is_empty();
            let is_closing = CLOSING_LINE
                .captures(line)
                .is_some_and(|closing| value_lines.contains(&closing[1]));
            let is_inside_value = value_lines.contains(line) || is_closing;

            if !is_blank_or_comment && !is_declaration && !is_inside_value {
                return Some(format!(
                    "line {}: expected VARIABLE=value, got \"{trimmed}\"",
                    index + 1
                ));
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::FileSyntax;
    use crate::StoreError;

    fn reason(path: &str, source: &str) -> Option<String> {
        match FileSyntax::check(path, Path::new(path), source) {
            Ok(()) => None,
            Err(StoreError::InvalidFile { reason, .. }) => Some(reason),
            Err(error) => panic!("{error:?}"),
        }
    }

    #[test]
    fn takes_several_documents_local_tags_and_an_empty_file_as_valid_yaml() {
        for source in [
            "",
            "a: 1\n---\nb: 2\n",
            "password: !secret db_password\n",
            "automation: !include automations.yaml\nlist: !list [a, b]\nmap: !map { a: 1 }\n",
            "base: &base { image: nginx }\nweb:\n  <<: *base\n",
        ] {
            assert_eq!(reason("config/settings.yaml", source), None, "{source:?}");
        }
    }

    #[test]
    fn refuses_yaml_that_does_not_parse_with_what_is_wrong() {
        assert!(reason("config.yml", "a: [1, 2\n").is_some());
        assert!(
            reason("config.yml", "a: 1\na: 2\n").is_some(),
            "a duplicate key"
        );
        assert!(reason("config.yml", "a:\n\tb: 1\n").is_some(), "a tab");
    }

    #[test]
    fn takes_variables_comments_blanks_and_values_over_several_lines_as_valid_dotenv() {
        let source = "# a comment\n\nA=1\nexport B = two\nC=\"first\nsecond\"\nD='x'\r\nE: colon\nF=\"one\ntwo\" # it's commented\n";

        assert_eq!(reason("web.env", source), None);
    }

    #[test]
    fn refuses_a_dotenv_line_that_dotenv_would_skip_naming_it() {
        assert_eq!(
            reason("web.env", "A=1\nBROKEN LINE\n").as_deref(),
            Some("line 2: expected VARIABLE=value, got \"BROKEN LINE\"")
        );
    }

    #[test]
    fn checks_a_file_by_its_own_extension_not_by_that_of_the_path_asked() {
        let refused = FileSyntax::check("settings.txt", Path::new("/app/settings.yml"), "a: [1\n");
        let passed = FileSyntax::check("settings.yml", Path::new("/app/settings.txt"), "a: [1\n");

        assert!(
            matches!(refused, Err(StoreError::InvalidFile { ref path, .. }) if path == "settings.txt"),
            "{refused:?}"
        );
        assert!(passed.is_ok(), "{passed:?}");
    }

    #[test]
    fn checks_nothing_of_another_extension() {
        assert_eq!(reason("README.md", "a: [1, 2\nBROKEN LINE"), None);
        assert_eq!(reason("nginx.conf", "{"), None);
    }
}
