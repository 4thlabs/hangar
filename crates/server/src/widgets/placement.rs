//! The key of each widget placed: what names its data and its images, whichever column it sits in.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use hangar_core::Widget;

/// A widget placed on the dashboard, and its key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Placement {
    /// `<type>-<hash>` of the widget's options, with `-2`, `-3`... for a second and third placement of the same.
    pub(crate) key: String,
    pub(crate) widget: Widget,
}

impl Placement {
    /// The radix the hash is written in, as the Waku version writes its keys: digits and lowercase letters.
    const RADIX: u32 = 36;

    /// Each widget of `widgets`, in their order, under its key.
    pub(crate) fn all(widgets: Vec<Widget>) -> Vec<Self> {
        let mut seen: HashMap<String, usize> = HashMap::new();

        widgets
            .into_iter()
            .map(|widget| {
                let key = format!("{}-{}", widget.kind.name(), Self::hash(&widget));
                let count = seen.entry(key.clone()).or_default();

                *count += 1;

                let key = match *count {
                    1 => key,
                    count => format!("{key}-{count}"),
                };

                Self { key, widget }
            })
            .collect()
    }

    /// FNV-1a of the widget's type and options, not of its column: moving a card keeps what it loaded.
    fn hash(widget: &Widget) -> String {
        let mut hasher = Fnv::default();

        widget.kind.hash(&mut hasher);

        let mut hash = hasher.finish();
        let mut digits = Vec::new();

        loop {
            let digit =
                u32::try_from(hash % u64::from(Self::RADIX)).expect("a digit is below the radix");

            digits.push(char::from_digit(digit, Self::RADIX).expect("a digit of the radix"));
            hash /= u64::from(Self::RADIX);

            if hash == 0 {
                break;
            }
        }

        digits.iter().rev().collect()
    }
}

/// FNV-1a over 64 bits: the same hash of the same options from one start of the server to the next, which the
/// standard library's hasher does not promise. Two declarations that hash alike still get keys of their own.
struct Fnv(u64);

impl Default for Fnv {
    fn default() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
}

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }
}

#[cfg(test)]
mod tests {
    use hangar_core::Config;

    use super::Placement;

    fn keys(widgets: &str) -> Vec<String> {
        let config = Config::parse(&format!("categories: []\nwidgets:\n{widgets}"))
            .expect("the configuration is valid");

        Placement::all(config.widgets)
            .into_iter()
            .map(|placement| placement.key)
            .collect()
    }

    #[test]
    fn names_a_placement_by_its_type_and_options_whatever_its_column() {
        let first = keys("  - { type: gluetun-vpn-status, column: 1, url: http://gluetun:8000 }\n");
        let moved = keys("  - { type: gluetun-vpn-status, column: 3, url: http://gluetun:8000 }\n");
        let other = keys("  - { type: gluetun-vpn-status, column: 1, url: http://vpn:8000 }\n");

        assert!(first[0].starts_with("gluetun-vpn-status-"), "{first:?}");
        assert_eq!(first, moved);
        assert_ne!(first, other);
    }

    #[test]
    fn numbers_the_placements_of_the_same_options() {
        let keys = keys(
            "  - { type: clock, column: 1 }\n  - { type: clock, column: 2 }\n  - { type: clock, column: 3 }\n",
        );

        assert_eq!(keys[1], format!("{}-2", keys[0]));
        assert_eq!(keys[2], format!("{}-3", keys[0]));
    }
}
