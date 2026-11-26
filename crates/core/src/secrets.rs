//! The values a command's output may echo that its reader must not see: those of `.env.global` and of this process's
//! environment, as an interpolation error of compose echoes the value at fault.

use std::collections::BTreeMap;

/// Values taken out of a text before it is shown, each replaced by `***`.
///
/// ```
/// use std::collections::BTreeMap;
///
/// use hangar_core::Secrets;
///
/// let variables = BTreeMap::from([("TOKEN".to_owned(), "ghp_secret".to_owned()), ("TZ".to_owned(), "UTC".to_owned())]);
/// let secrets = Secrets::new(variables.values());
///
/// assert_eq!(secrets.mask("pulling with ghp_secret at 10:00 UTC"), "pulling with *** at 10:00 UTC");
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Secrets {
    /// The values, the longest first, so that a value inside another goes with it.
    values: Vec<String>,
}

impl Secrets {
    /// The fewest characters a value has to be taken out: a shorter one, as `1` or `UTC`, is no secret, and taken out
    /// it would take every number of the text with it.
    pub const SHORTEST: usize = 4;

    /// The values of `values` of [`SHORTEST`](Self::SHORTEST) characters or more.
    pub fn new(values: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let mut values: Vec<String> = values
            .into_iter()
            .map(Into::into)
            .filter(|value| value.chars().count() >= Self::SHORTEST)
            .collect();

        values.sort_by(|left, right| right.len().cmp(&left.len()).then_with(|| left.cmp(right)));
        values.dedup();

        Self { values }
    }

    /// The values of `variables`, those of `.env.global`, and of this process's environment, which compose inherits.
    pub fn with_environment(variables: &BTreeMap<String, String>) -> Self {
        let environment = std::env::vars_os().filter_map(|(_, value)| value.into_string().ok());

        Self::new(variables.values().cloned().chain(environment))
    }

    /// `text` with each value replaced by `***`.
    pub fn mask(&self, text: &str) -> String {
        self.values.iter().fold(text.to_owned(), |text, value| {
            text.replace(value.as_str(), "***")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Secrets;

    #[test]
    fn takes_a_value_inside_another_out_with_it() {
        let secrets = Secrets::new(["abcd", "xxabcdxx"]);

        assert_eq!(secrets.mask("[xxabcdxx] [abcd]"), "[***] [***]");
    }

    #[test]
    fn leaves_the_short_values_in() {
        assert_eq!(Secrets::new(["UTC", "1"]).mask("1 UTC"), "1 UTC");
    }
}
