//! The hash of a user's password, as `hangar.yml` holds it: argon2id, in a PHC string.

use std::fmt;
use std::sync::LazyLock;

use argon2::password_hash::phc;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::{Algorithm, Argon2, Params, Version};

/// A password that cannot be hashed, or a hash that `hangar.yml` cannot hold.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PasswordError {
    /// The password is shorter than [`PasswordHash::MIN_LENGTH`] or longer than [`PasswordHash::MAX_LENGTH`].
    #[error(
        "a password is {} to {} characters long",
        PasswordHash::MIN_LENGTH,
        PasswordHash::MAX_LENGTH
    )]
    Length,

    /// The text is no PHC string, or the hash of another algorithm than argon2id.
    #[error("must be an argon2id hash, as `hangar user hash` prints one")]
    NotArgon2id,

    /// The hash was made with other costs than those `hangar user hash` gives every hash.
    #[error("must be hashed with m=19456, t=2, p=1: run `hangar user hash` again")]
    OtherCosts,

    /// argon2 failed, as it does not with its own parameters.
    #[error("the password could not be hashed: {0}")]
    Hashing(String),
}

/// The argon2id hash of a password, in the PHC string that `hangar user hash` prints:
/// `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`.
///
/// Every hash takes argon2's default costs, OWASP's first recommendation for argon2id: 19 MiB of memory, two passes,
/// one lane, some 20 to 50 ms on a small server. [`parse`](Self::parse) takes no other: a check costs the same for
/// every user, and for an email that is no user's, which [`verify_none`](Self::verify_none) spends, so that its time
/// tells nothing.
///
/// Hashing and checking are slow on purpose and block: the server runs them through `spawn_blocking`.
///
/// ```
/// use hangar_core::PasswordHash;
///
/// let hash = PasswordHash::new("correct horse battery staple")?;
/// let stored = PasswordHash::parse(&hash.to_string())?;
///
/// assert!(stored.verify("correct horse battery staple"));
/// assert!(!stored.verify("Tr0ub4dor&3"));
/// # Ok::<(), hangar_core::PasswordError>(())
/// ```
#[derive(Clone, PartialEq, Eq)]
pub struct PasswordHash(String);

impl PasswordHash {
    /// The fewest characters of a password, as the Waku version's sign-in form asks.
    pub const MIN_LENGTH: usize = 8;
    /// The most characters of a password, as the Waku version's sign-in form takes.
    pub const MAX_LENGTH: usize = 128;

    /// Hashes `password` with a random salt and argon2's default costs.
    ///
    /// # Errors
    ///
    /// Returns [`PasswordError::Length`] for a password that is not 8 to 128 characters long.
    pub fn new(password: &str) -> Result<Self, PasswordError> {
        let length = password.chars().count();

        if !(Self::MIN_LENGTH..=Self::MAX_LENGTH).contains(&length) {
            return Err(PasswordError::Length);
        }

        let hash = Argon2::default()
            .hash_password(password.as_bytes())
            .map_err(|error| PasswordError::Hashing(error.to_string()))?;

        Ok(Self(hash.to_string()))
    }

    /// The hash that `text` holds, as `hangar.yml` gives it.
    ///
    /// # Errors
    ///
    /// Returns [`PasswordError::NotArgon2id`] for a text that is no argon2id PHC string, and
    /// [`PasswordError::OtherCosts`] for a hash of other costs, or another version or length, than argon2's defaults.
    pub fn parse(text: &str) -> Result<Self, PasswordError> {
        let hash = phc::PasswordHash::new(text).map_err(|_| PasswordError::NotArgon2id)?;
        let is_argon2id = hash.algorithm.as_str() == Algorithm::Argon2id.ident().as_str();
        let has_output = hash.salt.is_some() && hash.hash.is_some();

        if !is_argon2id || !has_output {
            return Err(PasswordError::NotArgon2id);
        }

        let params = Params::try_from(&hash).map_err(|_| PasswordError::NotArgon2id)?;
        let has_default_costs = params.m_cost() == Params::DEFAULT_M_COST
            && params.t_cost() == Params::DEFAULT_T_COST
            && params.p_cost() == Params::DEFAULT_P_COST;
        let has_default_shape = hash.version == Some(Version::default().into())
            && hash
                .hash
                .is_some_and(|output| output.len() == Params::DEFAULT_OUTPUT_LEN);

        if !has_default_costs || !has_default_shape {
            return Err(PasswordError::OtherCosts);
        }

        Ok(Self(text.to_owned()))
    }

    /// Whether `password` is the one hashed, compared in constant time by argon2.
    pub fn verify(&self, password: &str) -> bool {
        let Ok(hash) = phc::PasswordHash::new(&self.0) else {
            return false;
        };

        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    }

    /// Spends the time of a [`verify`](Self::verify) on no hash, for a sign-in whose user is unknown or has no
    /// password: the answer then takes as long as for a user with a wrong password, and says nothing of which users
    /// exist.
    pub fn verify_none(password: &str) {
        /// A hash of a password nobody types, made once with the default costs.
        static NOBODY: LazyLock<PasswordHash> = LazyLock::new(|| {
            PasswordHash::new("the hash of no user's password")
                .expect("the password is 8 to 128 characters long")
        });

        NOBODY.verify(password);
    }
}

impl fmt::Display for PasswordHash {
    /// The PHC string, as `hangar.yml` holds it.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Debug for PasswordHash {
    /// The algorithm alone: a hash in a log is a hash an attacker may try offline.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PasswordHash(argon2id)")
    }
}

#[cfg(test)]
mod tests {
    use super::{PasswordError, PasswordHash};

    #[test]
    fn checks_the_password_it_hashed_and_no_other() {
        let hash = PasswordHash::new("correct horse").expect("hashed");

        assert!(
            hash.to_string()
                .starts_with("$argon2id$v=19$m=19456,t=2,p=1$")
        );
        assert!(hash.verify("correct horse"));
        assert!(!hash.verify("correct horse "));
        assert!(!hash.verify(""));
    }

    #[test]
    fn salts_each_hash() {
        let first = PasswordHash::new("correct horse").expect("hashed");
        let second = PasswordHash::new("correct horse").expect("hashed");

        assert_ne!(first, second);
    }

    #[test]
    fn refuses_a_password_too_short_or_too_long() {
        assert_eq!(PasswordHash::new("seven77"), Err(PasswordError::Length));
        assert_eq!(
            PasswordHash::new(&"a".repeat(129)),
            Err(PasswordError::Length)
        );
        assert!(
            PasswordHash::new("éééééééé").is_ok(),
            "characters, not bytes"
        );
    }

    #[test]
    fn reads_back_the_hash_it_prints() {
        let hash = PasswordHash::new("correct horse").expect("hashed");
        let parsed = PasswordHash::parse(&hash.to_string()).expect("parsed");

        assert!(parsed.verify("correct horse"));
    }

    #[test]
    fn refuses_what_is_no_argon2id_hash() {
        let argon2i =
            "$argon2i$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$iWh06vD8Fy27wf9npn6FXWiCX4K6pW6Ue1Bnzz07Z8A";
        let no_hash = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ";

        for text in [
            "",
            "hunter2",
            "$2b$12$abcdefghijklmnopqrstuv",
            argon2i,
            no_hash,
        ] {
            assert_eq!(
                PasswordHash::parse(text),
                Err(PasswordError::NotArgon2id),
                "{text}"
            );
        }
    }

    #[test]
    fn refuses_a_hash_of_other_costs_than_the_defaults() {
        let output = "$c29tZXNhbHQ$iWh06vD8Fy27wf9npn6FXWiCX4K6pW6Ue1Bnzz07Z8A";

        for params in [
            "m=4194304,t=2,p=1",
            "m=19456,t=3,p=1",
            "m=19456,t=2,p=4",
            "m=8192,t=2,p=1",
        ] {
            let hash = format!("$argon2id$v=19${params}{output}");

            assert_eq!(
                PasswordHash::parse(&hash),
                Err(PasswordError::OtherCosts),
                "{params}"
            );
        }

        assert_eq!(
            PasswordHash::parse(&format!("$argon2id$v=16$m=19456,t=2,p=1{output}")),
            Err(PasswordError::OtherCosts),
            "another version"
        );
        assert_eq!(
            PasswordHash::parse(
                "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$iWh06vD8Fy27wf9npn6FXQ"
            ),
            Err(PasswordError::OtherCosts),
            "another length"
        );
    }

    #[test]
    fn keeps_the_hash_out_of_debug() {
        let hash = PasswordHash::new("correct horse").expect("hashed");

        assert_eq!(format!("{hash:?}"), "PasswordHash(argon2id)");
    }
}
