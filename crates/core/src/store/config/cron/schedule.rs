//! When a cron expression fires, as node-cron 4.6 finds its next run: the first second after a time, in its time zone,
//! whose month, day of the month, day of the week, hour, minute and second its fields each list. node-cron asks the
//! day of the month and the day of the week both, where the cron of Unix asks either: `0 0 13 * 5` is a Friday the
//! 13th alone.

use std::fmt;
use std::str::FromStr;

use jiff::civil::{Date, DateTime, Time};
use jiff::tz::TimeZone;
use jiff::{SignedDuration, Timestamp, Zoned};

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
    /// fires in none of the next hundred years. A time the clock skips or repeats is read as node-cron reads it: a time
    /// skipped, as when the clock moves forward an hour, reads as the one an hour after, which fires only when the
    /// expression lists it too; a time repeated, as when the clock moves back an hour, fires once, at its occurrence
    /// of the offset that the time read as UTC has, the later east of UTC, the earlier west of it.
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

    /// Whether `zoned`, a time it fires at as node-cron reads a local time, is one it fires at.
    fn fires_at(&self, zoned: &Zoned) -> bool {
        let local = zoned.datetime();

        self.fires_on(local.date())
            && self.hours.contains(&local.hour())
            && self.minutes.contains(&local.minute())
            && self.seconds.contains(&local.second())
    }

    /// The time `local` is in `time_zone`, as node-cron's `localTimeToTimestamp` reads it: `local` read as UTC, less
    /// the offset of the zone then; when the offset is another at the time that gives, the one of the two that reads
    /// back as `local`, else the later.
    fn read_as_node_cron(local: DateTime, time_zone: &TimeZone) -> Option<Zoned> {
        let guess = local.to_zoned(TimeZone::UTC).ok()?.timestamp();
        let less = |offset: jiff::tz::Offset| {
            guess.checked_sub(SignedDuration::from_secs(i64::from(offset.seconds())))
        };
        let first_offset = time_zone.to_offset(guess);
        let first = less(first_offset).ok()?;
        let second_offset = time_zone.to_offset(first);
        let reads_back = |time: Timestamp| time.to_zoned(time_zone.clone()).datetime() == local;
        let chosen = if second_offset == first_offset || reads_back(first) {
            first
        } else {
            let second = less(second_offset).ok()?;

            if reads_back(second) {
                second
            } else {
                first.max(second)
            }
        };

        Some(chosen.to_zoned(time_zone.clone()))
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

                    let Some(zoned) = Self::read_as_node_cron(date.to_datetime(time), time_zone)
                    else {
                        continue;
                    };

                    if zoned.timestamp().as_second() > start && self.fires_at(&zoned) {
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

    /// When node-cron 4.6 says each expression fires next after a time, in UTC, in central Europe, Sydney or New York,
    /// around the times their clocks skip or repeat, run on node-cron itself with `TZ` set.
    const NODE_CRON_ACROSS_CLOCK_CHANGES: [(&str, &str, &str, &str); 11] = [
        // Paris repeats 02:00 to 03:00 on 2026-10-25: 02:30 is 00:30Z, then 01:30Z.
        (
            PARIS,
            "30 2 * * *",
            "2026-10-24T22:00:00Z",
            "2026-10-25T01:30:00Z",
        ),
        (
            PARIS,
            "50 2 * * *",
            "2026-10-25T01:05:00Z",
            "2026-10-25T01:50:00Z",
        ),
        // Paris skips 02:00 to 03:00 on 2026-03-29.
        (
            PARIS,
            "30 2 * * *",
            "2026-03-28T23:00:00Z",
            "2026-03-30T00:30:00Z",
        ),
        (
            PARIS,
            "* * * * *",
            "2026-03-29T00:59:30Z",
            "2026-03-29T01:00:00Z",
        ),
        (
            PARIS,
            "0 3 * * *",
            "2026-03-28T23:00:00Z",
            "2026-03-29T01:00:00Z",
        ),
        // 01:30 read as UTC is past the change: its offset reads it as 00:30, the offset before as 01:30.
        (
            PARIS,
            "30 1 * * *",
            "2026-03-28T22:00:00Z",
            "2026-03-29T00:30:00Z",
        ),
        // Sydney skips 02:00 to 03:00 on 2026-10-04, and repeats 02:00 to 03:00 on 2026-04-05.
        (
            SYDNEY,
            "30 1 * * *",
            "2026-10-03T12:00:00Z",
            "2026-10-03T15:30:00Z",
        ),
        (
            SYDNEY,
            "30 2 * * *",
            "2026-04-04T14:00:00Z",
            "2026-04-04T16:30:00Z",
        ),
        // New York repeats 01:00 to 02:00 on 2026-11-01: 01:30 is 05:30Z, then 06:30Z.
        (
            NEW_YORK,
            "30 1 * * *",
            "2026-11-01T04:00:00Z",
            "2026-11-01T05:30:00Z",
        ),
        (
            NEW_YORK,
            "50 1 * * *",
            "2026-11-01T06:05:00Z",
            "2026-11-02T06:50:00Z",
        ),
        // New York skips 02:00 to 03:00 on 2026-03-08.
        (
            NEW_YORK,
            "30 2 * * *",
            "2026-03-08T05:00:00Z",
            "2026-03-09T06:30:00Z",
        ),
    ];

    /// Central Europe's time, as a POSIX `TZ` writes it.
    const PARIS: &str = "CET-1CEST,M3.5.0,M10.5.0/3";

    /// Sydney's time, as a POSIX `TZ` writes it.
    const SYDNEY: &str = "AEST-10AEDT,M10.1.0,M4.1.0/3";

    /// New York's time, as a POSIX `TZ` writes it.
    const NEW_YORK: &str = "EST5EDT,M3.2.0,M11.1.0";

    #[test]
    fn fires_when_node_cron_does_across_the_changes_of_the_clock() {
        for (zone, expression, after, fires) in NODE_CRON_ACROSS_CLOCK_CHANGES {
            let time_zone = TimeZone::posix(zone).expect("a POSIX time zone");
            let after: jiff::Timestamp = after.parse().expect("a time");
            let next = CronSchedule::parse(expression)
                .expect("a valid expression")
                .next_after(&after.to_zoned(time_zone))
                .expect("a time that comes");

            assert_eq!(
                next.timestamp().to_string(),
                fires,
                "{expression:?} after {after} in {zone}"
            );
        }
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
