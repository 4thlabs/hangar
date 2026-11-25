//! The rules of the Waku version's zod schema that serde does not have, as types to deserialize.
//!
//! serde_norway reads `null` as an empty list, an empty mapping or an absent option, where zod rejects it: a field
//! left empty, `shared:`, is an error in both versions. The fields go through these types for that, and for zod's
//! integers, which a float with no fraction is too: `keep: 7.0` is 7.

use std::fmt;
use std::marker::PhantomData;

use regex::Regex;
use serde::de::{self, Deserialize, Deserializer, SeqAccess, Visitor};

use crate::store::{AppId, Disk};

/// The largest integer zod's `z.int()` accepts, `Number.MAX_SAFE_INTEGER`.
pub(super) const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// A sequence of at least `MIN` and at most `MAX` items, never `null`.
#[derive(Debug, Clone)]
pub(super) struct List<T, const MIN: usize = 0, const MAX: usize = { usize::MAX }>(
    pub(super) Vec<T>,
);

impl<T, const MIN: usize, const MAX: usize> Default for List<T, MIN, MAX> {
    fn default() -> Self {
        Self(Vec::new())
    }
}

impl<'de, T: Deserialize<'de>, const MIN: usize, const MAX: usize> Deserialize<'de>
    for List<T, MIN, MAX>
{
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        /// Collects the items of a sequence, and rejects anything else.
        struct ListVisitor<T, const MIN: usize, const MAX: usize>(PhantomData<T>);

        impl<'de, T: Deserialize<'de>, const MIN: usize, const MAX: usize> Visitor<'de>
            for ListVisitor<T, MIN, MAX>
        {
            type Value = List<T, MIN, MAX>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a list")
            }

            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let mut items = Vec::new();

                while let Some(item) = sequence.next_element()? {
                    items.push(item);
                }

                if items.len() < MIN {
                    return Err(de::Error::custom(format!(
                        "must hold at least {MIN} item(s)"
                    )));
                }

                if items.len() > MAX {
                    return Err(de::Error::custom(format!("must hold at most {MAX} items")));
                }

                Ok(List(items))
            }
        }

        // `deserialize_any`: `deserialize_seq` would hand an empty sequence for `null`.
        deserializer.deserialize_any(ListVisitor(PhantomData))
    }
}

/// A string of at least one character, as `z.string().min(1)`.
#[derive(Debug, Clone)]
pub(super) struct NonEmpty(pub(super) String);

impl<'de> Deserialize<'de> for NonEmpty {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;

        if text.is_empty() {
            return Err(de::Error::custom("must not be empty"));
        }

        Ok(Self(text))
    }
}

/// A pattern a string must match, as a zod `.regex()`, and what it says of one that does not.
pub(super) trait Pattern {
    /// What is wrong with a string that does not match, as the zod rule says it.
    const MESSAGE: &str;

    /// The pattern.
    fn regex() -> &'static Regex;
}

/// A string that matches the pattern `P`.
#[derive(Debug, Clone)]
pub(super) struct Matching<P>(pub(super) String, PhantomData<P>);

impl<'de, P: Pattern> Deserialize<'de> for Matching<P> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;

        if !P::regex().is_match(&text) {
            return Err(de::Error::custom(P::MESSAGE));
        }

        Ok(Self(text, PhantomData))
    }
}

/// An app id, as `backups[].app` and the stacks of a category take one, so that it names a folder under `store/`.
#[derive(Debug, Clone)]
pub(super) struct AppIdPattern;

impl Pattern for AppIdPattern {
    const MESSAGE: &str = "invalid app id";

    fn regex() -> &'static Regex {
        AppId::regex()
    }
}

/// The name of a shared file: a single entry of `store/`, linked into `app-installed/` under the same name, never a
/// path that leaves either.
#[derive(Debug, Clone)]
pub(super) struct EntryName(pub(super) String);

impl<'de> Deserialize<'de> for EntryName {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;

        if !Disk::is_entry_name(&name) {
            return Err(de::Error::custom(
                "must be a file name under store/, without a separator, . or ..",
            ));
        }

        Ok(Self(name))
    }
}

/// A whole number from `MIN` to `MAX`, as `z.int()` with its bounds: a float with no fraction is one too.
#[derive(Debug, Clone, Copy)]
pub(super) struct Integer<const MIN: i64, const MAX: i64>(pub(super) i64);

impl<const MIN: i64, const MAX: i64> Integer<MIN, MAX> {
    /// `value` if it is within the bounds.
    fn bounded<E: de::Error>(value: i64) -> Result<Self, E> {
        if !(MIN..=MAX).contains(&value) {
            return Err(E::custom(format!("must be from {MIN} to {MAX}")));
        }

        Ok(Self(value))
    }

    /// The value, which the bounds keep non-negative where this is called.
    pub(super) fn unsigned(self) -> u64 {
        u64::try_from(self.0).expect("the bounds of this integer start at 0 or above")
    }
}

impl<'de, const MIN: i64, const MAX: i64> Deserialize<'de> for Integer<MIN, MAX> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        /// Takes an integer, or a float with no fraction, and rejects anything else.
        struct IntegerVisitor<const MIN: i64, const MAX: i64>;

        impl<const MIN: i64, const MAX: i64> Visitor<'_> for IntegerVisitor<MIN, MAX> {
            type Value = Integer<MIN, MAX>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an integer")
            }

            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Integer::bounded(value)
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
                let value = i64::try_from(value).unwrap_or(i64::MAX);

                Integer::bounded(value)
            }

            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
                // The safe integers are exact as floats, and a whole one within them converts back exactly.
                let is_safe_integer =
                    value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER as f64;

                if !is_safe_integer {
                    return Err(E::invalid_type(de::Unexpected::Float(value), &self));
                }

                Integer::bounded(value as i64)
            }
        }

        // `deserialize_any`: a typed integer would refuse a float, which zod takes when it has no fraction.
        deserializer.deserialize_any(IntegerVisitor)
    }
}

/// Deserializes an option that is present: absent is `None` through `#[serde(default)]`, and `null`, which zod's
/// `.optional()` rejects, is an error rather than `None`.
pub(super) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_norway::Value;

    use super::{Integer, List, MAX_SAFE_INTEGER, NonEmpty, present};

    /// A record with a field of each rule.
    #[derive(Debug, Deserialize)]
    struct Record {
        #[serde(default)]
        list: List<NonEmpty, 1, 2>,
        #[serde(default, deserialize_with = "present")]
        option: Option<String>,
        #[serde(default, deserialize_with = "present")]
        integer: Option<Integer<1, MAX_SAFE_INTEGER>>,
    }

    fn parse(source: &str) -> Result<Record, serde_norway::Error> {
        let document: Value = serde_norway::from_str(source).expect("the YAML is valid");

        serde_norway::from_value(document)
    }

    #[test]
    fn rejects_null_where_zod_does() {
        assert!(parse("list:\n").is_err());
        assert!(parse("option: null\n").is_err());
        assert!(parse("integer: ~\n").is_err());
    }

    #[test]
    fn takes_an_absent_field_as_its_default() {
        let record = parse("{}").expect("every field has a default");

        assert!(record.list.0.is_empty());
        assert_eq!(record.option, None);
        assert!(record.integer.is_none());
    }

    #[test]
    fn bounds_the_length_of_a_list_and_of_its_strings() {
        assert!(parse("list: []\n").is_err());
        assert!(parse("list: [a, b, c]\n").is_err());
        assert!(parse("list: ['']\n").is_err());
        assert!(parse("list: [1]\n").is_err());
        assert_eq!(
            parse("list: [a, b]\n").expect("two items fit").list.0.len(),
            2
        );
    }

    #[test]
    fn takes_a_whole_float_as_an_integer_and_nothing_past_the_safe_ones() {
        let integer = |source| parse(source).map(|record| record.integer.map(|integer| integer.0));

        assert_eq!(integer("integer: 7.0\n").expect("7.0 is whole"), Some(7));
        assert!(integer("integer: 7.5\n").is_err());
        assert!(integer("integer: 0\n").is_err());
        assert!(integer("integer: 9007199254740992\n").is_err());
        assert!(integer("integer: '7'\n").is_err());
    }
}
