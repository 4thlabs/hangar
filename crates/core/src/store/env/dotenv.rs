//! `.env.global` read as dotenv 17's `parse` reads it, which the Waku version uses: a file hand-edited for one reads
//! the same in the other.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex::Regex;

/// One variable, as dotenv's `LINE` matches it: `KEY=value`, `export KEY=value` or `KEY: value`, the value quoted
/// with `'`, `"` or `` ` `` (over several lines, then) or bare up to a `#`. JavaScript's `\w` is ASCII.
static LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?m)^\s*(?:export\s+)?([A-Za-z0-9_.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$"#,
    )
    .expect("the pattern is valid")
});

/// dotenv's parser.
pub(super) struct Dotenv;

impl Dotenv {
    /// The variables of `source`; a key declared twice takes its last value.
    pub(super) fn parse(source: &str) -> BTreeMap<String, String> {
        let source = source.replace("\r\n", "\n").replace('\r', "\n");

        LINE.captures_iter(&source)
            .map(|line| {
                let value = line.get(2).map_or("", |value| value.as_str());

                (line[1].to_owned(), Self::value(value))
            })
            .collect()
    }

    /// A value trimmed, without the quotes around it, and with `\n` and `\r` expanded when they are double quotes.
    fn value(raw: &str) -> String {
        let value = raw.trim();
        let mut characters = value.chars();
        let first = characters.next();
        let is_quoted = first.is_some_and(|quote| "'\"`".contains(quote))
            && value.len() >= 2
            && characters.next_back() == first;
        let unquoted = if is_quoted {
            &value[1..value.len() - 1]
        } else {
            value
        };

        if first == Some('"') {
            return unquoted.replace(r"\n", "\n").replace(r"\r", "\r");
        }

        unquoted.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::Dotenv;

    /// What dotenv 17's `parse` answers, run on dotenv itself.
    const DOTENV: [(&str, &[(&str, &str)]); 36] = [
        ("A=1", &[("A", "1")]),
        ("export B = two ", &[("B", "two")]),
        ("C='single # not comment'", &[("C", "single # not comment")]),
        ("D=\"line\\nbreak\"", &[("D", "line\nbreak")]),
        ("E=`tick`", &[("E", "tick")]),
        ("F=unquoted # comment", &[("F", "unquoted")]),
        ("G=", &[("G", "")]),
        ("H", &[]),
        ("I: colon value", &[("I", "colon value")]),
        ("J=\"multi\nline\"", &[("J", "multi\nline")]),
        ("K='a' 'b'", &[("K", "a' 'b")]),
        ("L=\"a\" \"b\"", &[("L", "a\" \"b")]),
        ("M='unterminated", &[("M", "'unterminated")]),
        ("N=  spaced  ", &[("N", "spaced")]),
        ("dup=1\ndup=2", &[("dup", "2")]),
        ("O.P-Q=x", &[("O.P-Q", "x")]),
        ("R=\"esc \\\"q\\\" \"", &[("R", "esc \\\"q\\\" ")]),
        ("S=a=b=c", &[("S", "a=b=c")]),
        ("T=\r\nU=crlf\r\n", &[("T", ""), ("U", "crlf")]),
        ("#X=commented\nY=yes", &[("Y", "yes")]),
        ("  Z = padded", &[("Z", "padded")]),
        ("V='single \\n stays'", &[("V", "single \\n stays")]),
        ("W=\"\"", &[("W", "")]),
        ("AA=''", &[("AA", "")]),
        ("AB=#nocomment", &[("AB", "")]),
        ("AC= #comment", &[("AC", "")]),
        ("AD=\"x\" # c", &[("AD", "x")]),
        (
            "AE=\"unclosed\nAF=next",
            &[("AE", "\"unclosed"), ("AF", "next")],
        ),
        ("é=accent", &[]),
        ("AG=tab\there", &[("AG", "tab\there")]),
        ("AH=\"a\nb\" trailing", &[("AH", "\"a")]),
        ("AI='", &[("AI", "'")]),
        ("AJ=\"", &[("AJ", "\"")]),
        ("AK=a#b", &[("AK", "a")]),
        ("AL:x", &[]),
        ("AM:  y", &[("AM", "y")]),
    ];

    #[test]
    fn reads_as_dotenv_does() {
        for (source, expected) in DOTENV {
            let expected: BTreeMap<String, String> = expected
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect();

            assert_eq!(Dotenv::parse(source), expected, "{source:?}");
        }
    }
}
