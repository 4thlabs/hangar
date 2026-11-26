//! The `users:` of `hangar.yml`: who may sign in to Hangar's server, by password or through its OpenID Connect
//! provider. There are no roles: a user may do everything, as with the Waku version's one account.

use serde::Deserialize;
use serde::de::{self, Deserializer};

use super::ConfigError;
use super::rules::{List, NonEmpty, present};
use crate::{PasswordError, PasswordHash};

/// Someone who may sign in.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct User {
    /// The name the page shows.
    pub name: String,
    /// The email the user signs in with, and the one an OpenID Connect provider must give, verified, for a user
    /// with no [`oidc_subject`](Self::oidc_subject). Compared without regard to case.
    pub email: String,
    /// The hash of the password, from `passwordHash`; `None`, the user signs in through the provider alone.
    pub password_hash: Option<PasswordHash>,
    /// The subject, `sub`, the provider gives the user, from `oidcSubject`. Set, the provider signs the user in by it
    /// alone, whatever the email it gives.
    pub oidc_subject: Option<String>,
}

impl User {
    /// Whether `email` is this user's, whatever its case.
    pub fn has_email(&self, email: &str) -> bool {
        self.email.eq_ignore_ascii_case(email)
    }

    /// Checks that no two users share an email or a subject, naming the entry that repeats one.
    pub(super) fn check_unique(users: &[Self]) -> Result<(), ConfigError> {
        for (index, user) in users.iter().enumerate() {
            let earlier = &users[..index];

            if earlier.iter().any(|other| other.has_email(&user.email)) {
                return Err(ConfigError::invalid(
                    format!("users[{index}].email"),
                    format!("{} is listed twice", user.email),
                ));
            }

            let repeats_subject = user.oidc_subject.as_ref().is_some_and(|subject| {
                earlier
                    .iter()
                    .any(|other| other.oidc_subject.as_ref() == Some(subject))
            });

            if repeats_subject {
                return Err(ConfigError::invalid(
                    format!("users[{index}].oidcSubject"),
                    "is another user's subject",
                ));
            }
        }

        Ok(())
    }
}

/// A user as `hangar.yml` declares it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UserFields {
    name: NonEmpty,
    email: Email,
    #[serde(default, deserialize_with = "present")]
    password_hash: Option<StoredHash>,
    #[serde(default, deserialize_with = "present")]
    oidc_subject: Option<NonEmpty>,
}

impl From<UserFields> for User {
    fn from(fields: UserFields) -> Self {
        Self {
            name: fields.name.0,
            email: fields.email.0,
            password_hash: fields.password_hash.map(|hash| hash.0),
            oidc_subject: fields.oidc_subject.map(|subject| subject.0),
        }
    }
}

/// The users of `hangar.yml`, an empty list when it declares none.
pub(super) type UserList = List<UserFields>;

/// An email: one `@`, something on each side, no space, at most 254 characters as SMTP bounds a path.
struct Email(String);

impl Email {
    /// The longest email SMTP carries.
    const MAX_LENGTH: usize = 254;
}

impl<'de> Deserialize<'de> for Email {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let email = String::deserialize(deserializer)?;
        let is_email = match email.split_once('@') {
            Some((local, domain)) => {
                !local.is_empty() && !domain.is_empty() && !domain.contains('@')
            }
            None => false,
        };
        let has_space = email.chars().any(char::is_whitespace);

        if !is_email || has_space || email.len() > Self::MAX_LENGTH {
            return Err(de::Error::custom("must be an email"));
        }

        Ok(Self(email))
    }
}

/// A password hash that a sign-in can check.
struct StoredHash(PasswordHash);

impl<'de> Deserialize<'de> for StoredHash {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;

        PasswordHash::parse(&text)
            .map(Self)
            .map_err(|error: PasswordError| de::Error::custom(error))
    }
}
