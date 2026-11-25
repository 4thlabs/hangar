//! The cron expressions of the backups, checked as node-cron 4.6's `validate` checks them, which the Waku version
//! schedules with: a schedule one version accepts, the other does too.
//!
//! node-cron rewrites an expression before it checks it: it resolves a nickname (`@daily`), adds the seconds to an
//! expression of five fields, turns the names of months and days into numbers, `*` into the field's range, and each
//! range into its values. This follows the same steps, quirks included: a range that wraps (`50-10`) is valid, a step
//! of 0 is not, and day 7 is Sunday.

use std::sync::LazyLock;

use regex::Regex;

/// The nicknames node-cron accepts, and what they stand for.
const NICKNAMES: [(&str, &str); 7] = [
    ("@yearly", "0 0 1 1 *"),
    ("@annually", "0 0 1 1 *"),
    ("@monthly", "0 0 1 * *"),
    ("@weekly", "0 0 * * 0"),
    ("@daily", "0 0 * * *"),
    ("@midnight", "0 0 * * *"),
    ("@hourly", "0 * * * *"),
];

/// The names of the months, numbered from 1, the full ones replaced before the short ones.
const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// The short names of the months.
const SHORT_MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// The names of the days of the week, numbered from 0, Sunday.
const WEEK_DAYS: [&str; 7] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];

/// The short names of the days of the week.
const SHORT_WEEK_DAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/// The range `*` stands for in each field: seconds, minutes, hours, days of the month, months and days of the week.
const ASTERISK_RANGES: [&str; 6] = ["0-59", "0-59", "0-23", "1-31", "1-12", "0-6"];

/// The bounds a range that wraps around goes through, in each field.
const RANGE_BOUNDS: [(i128, i128); 6] = [(0, 59), (0, 59), (0, 23), (1, 31), (1, 12), (0, 6)];

/// The most days each month has, from January.
const MAX_DAYS_IN_MONTH: [i128; 12] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// A value no field accepts, past which a range stops being expanded: the expression is invalid already.
const BEYOND_EVERY_FIELD: i128 = 60;

/// `a-b` or `a-b/step`.
static RANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d+)-(\d+)(?:/(\d+))?$").expect("the pattern is valid"));

/// A value the checks accept: a number, `*` or `*/n`.
static VALID_VALUE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:\d+|\*|\*/\d+)$").expect("the pattern is valid"));

/// The nearest weekday to a day of the month, `15W`, or to the last one, `LW`.
static NEAREST_WEEKDAY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(\d{1,2}|L)W$").expect("the pattern is valid"));

/// The last day of the month but `n`, `L-3`.
static LAST_DAY_OFFSET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^L-(\d{1,2})$").expect("the pattern is valid"));

/// The `n`th such day of the week in the month, `1#2`.
static NTH_WEEK_DAY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-7]#[1-5]$").expect("the pattern is valid"));

/// The last such day of the week in the month, `5L`.
static LAST_WEEK_DAY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-7]L$").expect("the pattern is valid"));

/// One value of a field once rewritten: a number, or a text node-cron keeps as it is.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    Number(i128),
    Text(String),
}

/// A cron expression, as node-cron checks it.
pub(super) struct Cron;

impl Cron {
    /// Whether node-cron's `validate` accepts `expression`.
    pub(super) fn is_valid(expression: &str) -> bool {
        let resolved = Self::resolve_nickname(expression);
        let has_allowed_characters = !resolved.is_empty()
            && resolved.chars().all(|character| {
                character.is_ascii_alphanumeric() || "-*/,#? ".contains(character)
            });

        if !has_allowed_characters {
            return false;
        }

        let raw: Vec<&str> = resolved
            .split(' ')
            .filter(|field| !field.is_empty())
            .collect();

        if raw.len() != 5 && raw.len() != 6 {
            return false;
        }

        let mut patterns: Vec<String> = raw.iter().map(|field| (*field).to_owned()).collect();

        if patterns.len() == 5 {
            patterns.insert(0, "0".to_owned());
        }

        let fields = Self::convert(patterns.clone());

        Self::are_valid_values(&fields[0], 0, 59)
            && Self::are_valid_values(&fields[1], 0, 59)
            && Self::are_valid_values(&fields[2], 0, 23)
            && Self::is_valid_day_of_month(&fields[3], &patterns[3])
            && Self::are_valid_values(&fields[4], 1, 12)
            && Self::is_valid_week_day(&fields[5])
            && Self::is_possible_day_of_month(&fields[3], &fields[4])
    }

    /// The expression a nickname stands for, or `expression` itself.
    fn resolve_nickname(expression: &str) -> String {
        let key = expression.trim().to_lowercase();

        NICKNAMES
            .iter()
            .find(|(nickname, _)| *nickname == key)
            .map_or_else(
                || expression.to_owned(),
                |(_, resolved)| (*resolved).to_owned(),
            )
    }

    /// The six fields rewritten as node-cron's `convertExpression` does.
    fn convert(mut fields: Vec<String>) -> Vec<Vec<Token>> {
        for index in [3, 5] {
            if fields[index] == "?" {
                fields[index] = "*".to_owned();
            }
        }

        fields[4] = Self::replace_names(
            &Self::replace_names(&fields[4], &MONTHS, 1),
            &SHORT_MONTHS,
            1,
        );
        fields[5] = Self::replace_names(
            &Self::replace_names(&fields[5], &WEEK_DAYS, 0),
            &SHORT_WEEK_DAYS,
            0,
        );

        let mut converted: Vec<Vec<Token>> = fields
            .iter()
            .enumerate()
            .map(|(index, field)| {
                let field = Self::replace_asterisks(field, ASTERISK_RANGES[index]);
                let field = Self::expand_ranges(&field, RANGE_BOUNDS[index]);

                field.split(',').map(Self::token).collect()
            })
            .collect();

        converted[5] = Self::sunday_as_zero(&converted[5]);
        converted
    }

    /// `field` with each name replaced by its number, `first` for the first name, in any case.
    fn replace_names(field: &str, names: &[&str], first: usize) -> String {
        names
            .iter()
            .enumerate()
            .fold(field.to_owned(), |field, (index, name)| {
                Self::replace_ignoring_case(&field, name, &(first + index).to_string())
            })
    }

    /// Every occurrence of the ASCII `needle` in `haystack` replaced, in any case, left to right.
    fn replace_ignoring_case(haystack: &str, needle: &str, replacement: &str) -> String {
        let mut replaced = String::new();
        let mut rest = haystack;

        while !rest.is_empty() {
            let is_match = rest
                .get(..needle.len())
                .is_some_and(|start| start.eq_ignore_ascii_case(needle));

            if is_match {
                replaced.push_str(replacement);
                rest = &rest[needle.len()..];
                continue;
            }

            let mut characters = rest.chars();

            replaced.extend(characters.next());
            rest = characters.as_str();
        }

        replaced
    }

    /// The first `*` of each value replaced by the field's range.
    fn replace_asterisks(field: &str, range: &str) -> String {
        field
            .split(',')
            .map(|value| value.replacen('*', range, 1))
            .collect::<Vec<_>>()
            .join(",")
    }

    /// Each range of `field` replaced by its values, as node-cron's `convertRanges` does.
    fn expand_ranges(field: &str, bounds: (i128, i128)) -> String {
        field
            .split(',')
            .map(|value| {
                let Some(range) = RANGE.captures(value.trim()) else {
                    return value.to_owned();
                };
                let step_text = range.get(3).map_or("1", |step| step.as_str());

                Self::expand_range(&range[1], &range[2], step_text, bounds)
            })
            .collect::<Vec<_>>()
            .join(",")
    }

    /// The values from `first` to `last` by `step`, wrapping around the bounds when `last` is below `first`; the range
    /// as it is written when the step is 0, which the checks then reject.
    fn expand_range(first: &str, last: &str, step: &str, (min, max): (i128, i128)) -> String {
        let (first_value, last_value, step_value) =
            (Self::number(first), Self::number(last), Self::number(step));

        if step_value < 1 {
            return format!("{first}-{last}/{step}");
        }

        let mut values = Vec::new();

        if first_value <= last_value {
            let mut value = first_value;

            while value <= last_value {
                values.push(value);

                // One value past every field makes the expression invalid: the rest would change nothing.
                if value > BEYOND_EVERY_FIELD {
                    break;
                }

                value = value.saturating_add(step_value);
            }
        } else {
            let size = max - min + 1;
            let span = ((last_value - first_value) % size + size) % size;
            let mut offset = 0;

            while offset <= span {
                let value = first_value.saturating_add(offset);

                values.push(if value > max { value - size } else { value });
                offset = offset.saturating_add(step_value);
            }
        }

        values
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",")
    }

    /// A value as node-cron's `normalizeIntegers` leaves it.
    fn token(value: &str) -> Token {
        let value = value.trim();
        let is_last_day = value.eq_ignore_ascii_case("l");
        let keeps_its_case =
            value.contains('#') || !value.bytes().all(|byte| byte.is_ascii_digit());
        let is_uppercased = Self::is_last_day_offset(value)
            || Self::is_last_week_day(value)
            || value.to_ascii_lowercase().contains('w');

        if is_last_day {
            return Token::Text("L".to_owned());
        }

        if is_uppercased {
            return Token::Text(value.to_ascii_uppercase());
        }

        if keeps_its_case || value.is_empty() {
            return Token::Text(value.to_owned());
        }

        Token::Number(Self::number(value))
    }

    /// Whether `value` is `L-n`, in any case.
    fn is_last_day_offset(value: &str) -> bool {
        value.len() > 2
            && value[..2].eq_ignore_ascii_case("l-")
            && value.len() <= 4
            && value[2..].bytes().all(|byte| byte.is_ascii_digit())
    }

    /// Whether `value` is `nL`, in any case.
    fn is_last_week_day(value: &str) -> bool {
        LAST_WEEK_DAY.is_match(&value.to_ascii_uppercase())
    }

    /// The days of the week with 7 written as 0, both Sunday, each once.
    fn sunday_as_zero(days: &[Token]) -> Vec<Token> {
        let mut unique = Vec::new();

        for day in days {
            let day = match day {
                Token::Number(7) => Token::Number(0),
                Token::Text(text) if text.starts_with('7') => {
                    Token::Text(format!("0{}", &text[1..]))
                }
                other => other.clone(),
            };

            if !unique.contains(&day) {
                unique.push(day);
            }
        }

        unique
    }

    /// The digits of `text` as a number; one too large for any field is still too large.
    fn number(text: &str) -> i128 {
        text.parse().unwrap_or(i128::MAX)
    }

    /// node-cron's `isValidExpression`: every value is a number from `min` to `max`, or `*` or `*/n`.
    fn are_valid_values<'a>(
        values: impl IntoIterator<Item = &'a Token>,
        min: i128,
        max: i128,
    ) -> bool {
        values.into_iter().all(|value| match value {
            Token::Number(number) => (min..=max).contains(number),
            Token::Text(text) => {
                let leading_number = Self::parse_int(text);
                let is_out_of_bounds =
                    leading_number.is_some_and(|number| !(min..=max).contains(&number));

                !is_out_of_bounds && VALID_VALUE.is_match(text)
            }
        })
    }

    /// The days of the month, `L`, `LW`, `L-n` and `nW` aside, are from 1 to 31, and a `W` is only in `nW` or `LW`.
    fn is_valid_day_of_month(days: &[Token], pattern: &str) -> bool {
        let checked: Vec<&Token> = days
            .iter()
            .filter(|day| !Self::is_special_day_of_month(day))
            .collect();
        let has_misplaced_w = pattern.split(',').any(|value| {
            let value = value.trim();

            value.to_ascii_lowercase().contains('w') && !NEAREST_WEEKDAY.is_match(value)
        });

        Self::are_valid_values(checked, 1, 31) && !has_misplaced_w
    }

    /// Whether a day of the month is `L`, `LW`, a valid `nW` or a valid `L-n`, which the number checks leave out.
    fn is_special_day_of_month(day: &Token) -> bool {
        let Token::Text(text) = day else {
            return false;
        };

        if text == "L" {
            return true;
        }

        if let Some(weekday) = NEAREST_WEEKDAY.captures(text) {
            return &weekday[1] == "L" || (1..=31).contains(&Self::number(&weekday[1]));
        }

        if let Some(offset) = LAST_DAY_OFFSET.captures(text) {
            return (1..=30).contains(&Self::number(&offset[1]));
        }

        false
    }

    /// The days of the week, `n#k` and `nL` aside, are from 0 to 7.
    fn is_valid_week_day(days: &[Token]) -> bool {
        let checked = days.iter().filter(|day| match day {
            Token::Text(text) => !NTH_WEEK_DAY.is_match(text) && !LAST_WEEK_DAY.is_match(text),
            Token::Number(_) => true,
        });

        Self::are_valid_values(checked, 0, 7)
    }

    /// Whether one of the months has one of the days, when the days are all numbers: `31 2` never comes.
    fn is_possible_day_of_month(days: &[Token], months: &[Token]) -> bool {
        let numbered_days: Option<Vec<i128>> = days
            .iter()
            .map(|day| match day {
                Token::Number(number) => Some(*number),
                Token::Text(_) => None,
            })
            .collect();
        let Some(numbered_days) = numbered_days else {
            return true;
        };

        months.iter().any(|month| {
            let max_days = match month {
                Token::Number(number @ 1..=12) => usize::try_from(*number - 1)
                    .ok()
                    .and_then(|index| MAX_DAYS_IN_MONTH.get(index)),
                _ => None,
            };

            max_days.is_some_and(|max_days| numbered_days.iter().any(|day| day <= max_days))
        })
    }

    /// JavaScript's `parseInt(text, 10)`: the number its leading digits make, after blanks and a sign.
    fn parse_int(text: &str) -> Option<i128> {
        let text = text.trim_start();
        let (sign, digits) = match text.strip_prefix('-') {
            Some(rest) => (-1, rest),
            None => (1, text.strip_prefix('+').unwrap_or(text)),
        };
        let length = digits.bytes().take_while(u8::is_ascii_digit).count();

        if length == 0 {
            return None;
        }

        Some(sign * Self::number(&digits[..length]))
    }
}

#[cfg(test)]
mod tests {
    use super::Cron;

    /// What node-cron 4.6's `validate` answers, run on node-cron itself.
    const NODE_CRON: [(&str, bool); 75] = [
        ("30 3 * * *", true),
        ("61 * * * *", false),
        ("0 3 * * *", true),
        ("*/15 * * * *", true),
        ("0 0 31 2 *", false),
        ("0 0 30 2 *", false),
        ("0 0 29 2 *", true),
        ("0 0 L * *", true),
        ("0 0 15W * *", true),
        ("0 0 32W * *", false),
        ("0 0 LW * *", true),
        ("0 0 L-3 * *", true),
        ("0 0 L-31 * *", false),
        ("0 0 * * mon-fri", true),
        ("0 0 * * MON", true),
        ("0 0 * * 1#2", true),
        ("0 0 * * 1#6", false),
        ("0 0 * * 5L", true),
        ("0 0 * * 7L", true),
        ("@weekly", true),
        (" @Daily ", true),
        ("@reboot", false),
        ("0 0 * * 7", true),
        ("0 0 * * 8", false),
        ("1-5/0 * * * *", false),
        ("0 0 ? * *", true),
        ("0 0 * * ?", true),
        ("* * * * * * *", false),
        ("* * * *", false),
        ("a * * * *", false),
        ("0 0 1 jan *", true),
        ("0 0 1 JANUARY *", true),
        ("0 0 1 13 *", false),
        ("59-1 * * * *", true),
        ("0 0 1W,15w * *", true),
        ("0 0 1x * *", false),
        ("*/0 * * * *", false),
        ("0-59/60 * * * *", true),
        ("50-70/30 * * * *", true),
        ("0 0 * * 5-7", true),
        ("0 0 * * 6-1", true),
        ("  0   0  *  * * ", true),
        ("0\t0 * * *", false),
        ("", false),
        ("   ", false),
        ("0 0 0 * *", false),
        ("0 24 * * *", false),
        ("0 0 * 0 *", false),
        ("*/* * * * *", false),
        ("** * * * *", false),
        ("0 0 1-31/2 2 *", true),
        ("0 0 31 4,6 *", false),
        ("0 0 31 4,5 *", true),
        ("1,2,3 * * * *", true),
        ("1,,2 * * * *", false),
        ("05 * * * *", true),
        ("00 00 * * *", true),
        ("0 0 * * sun,sat", true),
        ("0 0 * * sunday", true),
        ("0 0 * jan-mar *", true),
        ("0 0 * mar-jan *", true),
        ("0 0 L * mon", true),
        ("0 0 * * L", false),
        ("0 0 W * *", false),
        ("0 0 1#2 * *", false),
        ("99999999999999999999 * * * *", false),
        ("0 0 * * 0#1,7#5", true),
        ("10-5 * * * *", true),
        ("0 0 * * 7-2", true),
        ("0 0 1 * * *", true),
        ("0 0 0 1 * *", true),
        ("0 0 lw * *", true),
        ("0 0 l * *", true),
        ("0 0 * * 5l", true),
        ("0 0 l-3 * *", true),
    ];

    #[test]
    fn answers_as_node_cron_does() {
        for (expression, is_valid) in NODE_CRON {
            assert_eq!(Cron::is_valid(expression), is_valid, "{expression:?}");
        }
    }

    #[test]
    fn rejects_seconds_out_of_bounds() {
        assert!(!Cron::is_valid("60 0 0 1 * *"));
    }

    #[test]
    fn expands_a_long_range_in_bounded_time() {
        assert!(!Cron::is_valid("0-99999999999 * * * *"));
    }

    #[test]
    fn takes_numbers_too_large_for_any_field_without_overflowing() {
        let huge = "9".repeat(50);

        assert!(!Cron::is_valid(&format!("{huge}-5 * * * *")));
        assert!(Cron::is_valid(&format!("1-5/{huge} * * * *")));
    }
}
