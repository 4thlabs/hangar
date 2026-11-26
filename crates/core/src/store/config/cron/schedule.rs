//! When a cron expression fires, as node-cron 4.6 finds its next run: the first second after a time, in its time zone,
//! whose month, day of the month, day of the week, hour, minute and second its fields each list. node-cron asks the
//! day of the month and the day of the week both, where the cron of Unix asks either: `0 0 13 * 5` is a Friday the
//! 13th alone.

use std::fmt;
use std::str::FromStr;

use jiff::Zoned;
use jiff::civil::{Date, Time};
use jiff::tz::TimeZone;

use super::{Cron, LAST_DAY_OFFSET, LAST_WEEK_DAY, NEAREST_WEEKDAY, NTH_WEEK_DAY, Token};

/// How many days ahead a schedule is looked at, as node-cron does.
const LOOKAHEAD_DAYS: usize = 366 * 100;

/// A cron expression that node-cron accepts, as `47 4 * * *`, which tells when it fires next: five fields, or six with
/// the seconds first, the names of months and days, the ranges, the steps and the nicknames as `@daily`, and in the
/// days `L`, `LW`, `15W`, `L-3`, `1#2` and `5L`, as node-cron reads them. Day 7 is Sunday, as day 0.
///
/// ```
/// use hangar_core::CronSchedule;
/// use jiff::Zoned;
///
/// let image_check: CronSchedule = "17 */4 * * *".parse()?;
/// let now: Zoned = "2026-11-26T09:30:00+00:00[UTC]".parse()?;
/// let next = image_check.next_after(&now).expect("a time that comes");
///
/// assert_eq!(next.to_string(), "2026-11-26T12:17:00+00:00[UTC]");
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronSchedule {
    /// As it was written.
    expression: String,
    seconds: Vec<i8>,
    minutes: Vec<i8>,
    hours: Vec<i8>,
    days: Vec<DayOfMonth>,
    months: Vec<i8>,
    week_days: Vec<DayOfWeek>,
}

/// A cron expression that node-cron does not accept.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid cron expression `{expression}`")]
pub struct CronError {
    expression: String,
}

/// A value of the field of the days of the month.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DayOfMonth {
    /// This day.
    Day(i8),
    /// The last day, `L`.
    Last,
    /// The weekday nearest to this day, in its month, `15W`.
    NearestWeekday(i8),
    /// The weekday nearest to the last day, `LW`.
    NearestWeekdayToLast,
    /// The day this many days before the last, `L-3`.
    BeforeLast(i8),
}

/// A value of the field of the days of the week, numbered from 0, Sunday.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DayOfWeek {
    /// This day.
    Day(i8),
    /// The `nth` such day of the month, `1#2`.
    Nth { day: i8, nth: i8 },
    /// The last such day of the month, `5L`.
    Last(i8),
}

impl CronSchedule {
    /// The schedule of `expression`.
    ///
    /// # Errors
    ///
    /// A [`CronError`] when node-cron does not accept `expression`.
    pub fn parse(expression: &str) -> Result<Self, CronError> {
        let Some(fields) = Cron::fields(expression) else {
            return Err(CronError {
                expression: expression.to_owned(),
            });
        };

        Ok(Self {
            expression: expression.to_owned(),
            seconds: Self::numbers(&fields[0]),
            minutes: Self::numbers(&fields[1]),
            hours: Self::numbers(&fields[2]),
            days: fields[3].iter().filter_map(DayOfMonth::read).collect(),
            months: Self::numbers(&fields[4]),
            week_days: fields[5].iter().filter_map(DayOfWeek::read).collect(),
        })
    }

    /// The first time it fires after `after`, past the second `after` is in, in `after`'s time zone; `None` when it
    /// fires in none of the next hundred years. A time the clock skips, as when it moves forward an hour, is not one:
    /// that day, it does not fire then.
    pub fn next_after(&self, after: &Zoned) -> Option<Zoned> {
        let time_zone = after.time_zone().clone();
        let start = after.timestamp().as_second();
        let local = after.datetime();
        let mut date = local.date();

        for day in 0..LOOKAHEAD_DAYS {
            let from = (day == 0).then(|| local.time());
            let found = self
                .fires_on(date)
                .then(|| self.first_time_on(date, from, start, &time_zone))
                .flatten();

            if found.is_some() {
                return found;
            }

            date = date.tomorrow().ok()?;
        }

        None
    }

    /// The numbers of a field, in order, each once: node-cron matches the time with them alone.
    fn numbers(tokens: &[Token]) -> Vec<i8> {
        let mut numbers: Vec<i8> = tokens
            .iter()
            .filter_map(|token| match token {
                Token::Number(number) => i8::try_from(*number).ok(),
                Token::Text(_) => None,
            })
            .collect();

        numbers.sort_unstable();
        numbers.dedup();
        numbers
    }

    /// Whether its month, its day of the month and its day of the week are all `date`'s.
    fn fires_on(&self, date: Date) -> bool {
        self.months.contains(&date.month())
            && self.days.iter().any(|day| day.matches(date))
            && self.week_days.iter().any(|day| day.matches(date))
    }

    /// The first time it fires on `date`, after `from` when that is given, and after the second `start`.
    fn first_time_on(
        &self,
        date: Date,
        from: Option<Time>,
        start: i64,
        time_zone: &TimeZone,
    ) -> Option<Zoned> {
        for &hour in &self.hours {
            for &minute in &self.minutes {
                for &second in &self.seconds {
                    let Ok(time) = Time::new(hour, minute, second, 0) else {
                        continue;
                    };

                    if from.is_some_and(|from| time <= from) {
                        continue;
                    }

                    let local = date.to_datetime(time);
                    let Ok(zoned) = local.to_zoned(time_zone.clone()) else {
                        continue;
                    };
                    // A time the clock skips reads as another: it is not one.
                    let exists = zoned.datetime() == local;

                    if exists && zoned.timestamp().as_second() > start {
                        return Some(zoned);
                    }
                }
            }
        }

        None
    }
}

impl DayOfMonth {
    /// A value of the field as node-cron rewrites it; `None` for one that matches no day.
    fn read(token: &Token) -> Option<Self> {
        let text = match token {
            Token::Number(number) => return i8::try_from(*number).ok().map(Self::Day),
            Token::Text(text) => text,
        };

        if text == "L" {
            return Some(Self::Last);
        }

        if let Some(nearest) = NEAREST_WEEKDAY.captures(text) {
            return match &nearest[1] {
                "L" => Some(Self::NearestWeekdayToLast),
                day => day.parse().ok().map(Self::NearestWeekday),
            };
        }

        LAST_DAY_OFFSET
            .captures(text)
            .and_then(|offset| offset[1].parse().ok())
            .map(Self::BeforeLast)
    }

    /// Whether it is `date`'s day.
    fn matches(self, date: Date) -> bool {
        let last = date.days_in_month();

        match self {
            Self::Day(day) => date.day() == day,
            Self::Last => date.day() == last,
            Self::NearestWeekday(day) => Self::nearest_weekday(date, day) == Some(date.day()),
            Self::NearestWeekdayToLast => Self::nearest_weekday(date, last) == Some(date.day()),
            Self::BeforeLast(offset) => last - offset >= 1 && date.day() == last - offset,
        }
    }

    /// The weekday nearest to the day `target` of `date`'s month, within the month: a Saturday the 1st moves to the
    /// Monday, a Sunday the last day to the Friday. `None` for a day the month does not have.
    fn nearest_weekday(date: Date, target: i8) -> Option<i8> {
        let last = date.days_in_month();
        let target_date = Date::new(date.year(), date.month(), target).ok()?;
        let nearest = match target_date.weekday().to_sunday_zero_offset() {
            6 if target == 1 => target + 2,
            6 => target - 1,
            0 if target == last => target - 2,
            0 => target + 1,
            _ => target,
        };

        Some(nearest)
    }
}

impl DayOfWeek {
    /// A value of the field as node-cron rewrites it; `None` for one that matches no day.
    fn read(token: &Token) -> Option<Self> {
        let text = match token {
            Token::Number(number) => return i8::try_from(*number).ok().map(Self::Day),
            Token::Text(text) => text,
        };
        let day = |digit: &str| digit.parse::<i8>().ok().map(|day| day % 7);

        if NTH_WEEK_DAY.is_match(text) {
            let (week_day, nth) = text.split_once('#')?;

            return Some(Self::Nth {
                day: day(week_day)?,
                nth: nth.parse().ok()?,
            });
        }

        if LAST_WEEK_DAY.is_match(text) {
            return day(text.strip_suffix('L')?).map(Self::Last);
        }

        None
    }

    /// Whether it is `date`'s day.
    fn matches(self, date: Date) -> bool {
        let week_day = date.weekday().to_sunday_zero_offset();

        match self {
            Self::Day(day) => week_day == day,
            Self::Nth { day, nth } => week_day == day && (date.day() - 1) / 7 + 1 == nth,
            Self::Last(day) => week_day == day && date.day() + 7 > date.days_in_month(),
        }
    }
}

impl FromStr for CronSchedule {
    type Err = CronError;

    fn from_str(expression: &str) -> Result<Self, Self::Err> {
        Self::parse(expression)
    }
}

/// The expression as it was written.
impl fmt::Display for CronSchedule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.expression)
    }
}

#[cfg(test)]
mod tests {
    use jiff::tz::TimeZone;

    use super::CronSchedule;

    /// When node-cron 4.6's `getNextMatch` says each expression fires next after a time, in UTC, run on node-cron itself.
    const NODE_CRON: [(&str, &str, &str); 27] = [
        ("17 */4 * * *", "2026-11-26T09:30:00", "2026-11-26T12:17:00"),
        (
            "47 4 * * *",
            "2026-11-26T04:47:00.500",
            "2026-11-27T04:47:00",
        ),
        (
            "*/20 * * * * *",
            "2026-11-26T10:00:41",
            "2026-11-26T10:01:00",
        ),
        ("0 0 13 * 5", "2026-11-26T00:00:00", "2027-08-13T00:00:00"),
        (
            "0 9 * * mon-fri",
            "2026-11-27T10:00:00",
            "2026-11-30T09:00:00",
        ),
        ("@weekly", "2026-11-26T00:00:00", "2026-11-29T00:00:00"),
        (
            "0 0 1 nov-feb *",
            "2026-03-01T00:00:00",
            "2026-11-01T00:00:00",
        ),
        ("0 0 * * 7", "2026-11-26T00:00:00", "2026-11-29T00:00:00"),
        ("0 0 31 4,5 *", "2026-01-01T00:00:00", "2026-05-31T00:00:00"),
        ("0 0 L * *", "2026-02-01T00:00:00", "2026-02-28T00:00:00"),
        ("0 0 L-3 * *", "2026-02-01T00:00:00", "2026-02-25T00:00:00"),
        ("0 0 15W * *", "2026-08-01T00:00:00", "2026-08-14T00:00:00"),
        ("0 0 1W * *", "2026-07-31T00:00:00", "2026-08-03T00:00:00"),
        ("0 0 LW * *", "2026-05-01T00:00:00", "2026-05-29T00:00:00"),
        ("0 0 * * 1#2", "2026-12-01T00:00:00", "2026-12-14T00:00:00"),
        ("0 0 * * 5L", "2026-12-01T00:00:00", "2026-12-25T00:00:00"),
        ("0 0 * * 7L", "2026-12-01T00:00:00", "2026-12-27T00:00:00"),
        (
            "0 0 * * 0#1,7#5",
            "2026-12-01T00:00:00",
            "2026-12-06T00:00:00",
        ),
        ("59-1 * * * *", "2026-12-01T00:02:00", "2026-12-01T00:59:00"),
        ("0 0 * * 6-1", "2026-12-02T00:00:00", "2026-12-05T00:00:00"),
        (
            "50-70/30 * * * *",
            "2026-12-01T00:00:00",
            "2026-12-01T00:50:00",
        ),
        ("0 0 L * mon", "2026-01-01T00:00:00", "2026-08-31T00:00:00"),
        ("0 0 31W * *", "2026-04-01T00:00:00", "2026-05-29T00:00:00"),
        ("0 0 lw * *", "2026-01-01T00:00:00", "2026-01-30T00:00:00"),
        (
            "0 0 1-31/2 2 *",
            "2026-02-02T00:00:00",
            "2026-02-03T00:00:00",
        ),
        ("0 0 ? * ?", "2026-02-02T00:00:00", "2026-02-03T00:00:00"),
        ("0 0 1 1 * *", "2026-02-02T00:00:00", "2026-03-01T01:00:00"),
    ];

    /// When `expression` fires next after `after`, a time of UTC written without its zone, as `2026-11-26T09:30:00`.
    fn next(expression: &str, after: &str) -> String {
        let after: jiff::civil::DateTime = after.parse().expect("a date and a time");
        let after = after.to_zoned(TimeZone::UTC).expect("a time of UTC");
        let next = CronSchedule::parse(expression)
            .expect("a valid expression")
            .next_after(&after)
            .expect("a time that comes");

        next.datetime().to_string()
    }

    #[test]
    fn fires_when_node_cron_does() {
        for (expression, after, fires) in NODE_CRON {
            assert_eq!(
                next(expression, after),
                fires,
                "{expression:?} after {after}"
            );
        }
    }

    #[test]
    fn fires_after_the_second_it_is_asked_in_never_within_it() {
        assert_eq!(
            next("47 4 * * *", "2026-11-26T04:47:00.5"),
            "2026-11-27T04:47:00"
        );
        assert_eq!(
            next("47 4 * * *", "2026-11-26T04:46:59.9"),
            "2026-11-26T04:47:00"
        );
    }

    #[test]
    fn does_not_fire_at_a_time_the_clock_skips() {
        // Central Europe moves from 02:00 to 03:00 on 2026-03-29: 02:30 does not exist that day.
        let paris = TimeZone::posix("CET-1CEST,M3.5.0,M10.5.0/3").expect("a POSIX time zone");
        let after = jiff::civil::date(2026, 3, 29)
            .at(0, 0, 0, 0)
            .to_zoned(paris)
            .expect("a time of the zone");
        let next = CronSchedule::parse("30 2 * * *")
            .expect("a valid expression")
            .next_after(&after)
            .expect("a time that comes");

        assert_eq!(next.datetime().to_string(), "2026-03-30T02:30:00");
    }

    #[test]
    fn refuses_an_expression_node_cron_does_not_accept() {
        let error = CronSchedule::parse("0 0 31 2 *").expect_err("an invalid expression");

        assert_eq!(error.to_string(), "invalid cron expression `0 0 31 2 *`");
    }

    #[test]
    fn says_the_expression_as_it_was_written() {
        let schedule: CronSchedule = " @Daily ".parse().expect("a valid expression");

        assert_eq!(schedule.to_string(), " @Daily ");
    }
}
