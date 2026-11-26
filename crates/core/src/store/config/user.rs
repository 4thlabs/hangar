//! The `users:` of `hangar.yml`: who may sign in to Hangar's server, by password or through its OpenID Connect
//! provider. There are no roles: a user may do everything, as with the Waku version's one account.

use serde::Deserialize;
use serde::de::{self, Deserializer};

use super::super::Yaml;
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
    /// The users `source`, a `hangar.yml`, lists, each email and each subject once; none when it lists no one.
    ///
    /// They are read apart from the rest of the file, which [`Config::parse`](crate::Config::parse) reads, and
    /// whatever its other fields hold: a mistake among the users is the server's alone.
    ///
    /// ```
    /// use hangar_core::User;
    ///
    /// let users = User::list("categories: []\nusers:\n  - { name: Ana, email: ana@example.com }\n")?;
    ///
    /// assert_eq!(users[0].name, "Ana");
    /// assert!(users[0].has_email("ANA@example.com"));
    /// # Ok::<(), hangar_core::ConfigError>(())
    /// ```
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Syntax`] when `source` is not a single YAML document, and [`ConfigError::Invalid`],
    /// naming the first field at fault, when a user does not follow the rules: no name, no email or one listed
    /// twice, a hash `hangar user hash` did not print, a subject listed twice.
    pub fn list(source: &str) -> Result<Vec<Self>, ConfigError> {
        let document = Yaml::load(source).map_err(ConfigError::Syntax)?;
        let fields: UsersFields = serde_path_to_error::deserialize(document)
            .map_err(|error| ConfigError::deserializing("", &error))?;
        let users: Vec<Self> = fields.users.0.into_iter().map(Self::from).collect();

        Self::check_unique(&users)?;

        Ok(users)
    }

    /// Whether `email` is this user's, whatever its case.
    pub fn has_email(&self, email: &str) -> bool {
        self.email.eq_ignore_ascii_case(email)
    }

    /// Checks that no two users share an email or a subject, naming the entry that repeats one.
    fn check_unique(users: &[Self]) -> Result<(), ConfigError> {
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

/// The users of `hangar.yml`, and nothing else of it.
#[derive(Deserialize)]
#[serde(expecting = "a mapping")]
struct UsersFields {
    #[serde(default)]
    users: List<UserFields>,
}

/// A user as `hangar.yml` declares it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserFields {
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

#[cfg(test)]
mod tests {
    use super::User;
    use crate::{ConfigError, PasswordHash};

    /// The field and the message of users that do not follow the rules.
    fn invalid(source: &str) -> (String, String) {
        match User::list(source) {
            Err(ConfigError::Invalid { field, message }) => (field, message),
            other => panic!("expected invalid users, got {other:?}"),
        }
    }

    #[test]
    fn lists_nobody_when_the_file_lists_no_one() {
        assert!(User::list("categories: []\n").expect("valid").is_empty());
    }

    #[test]
    fn reads_the_users_whatever_the_rest_of_the_file_holds() {
        let hash = PasswordHash::new("correct horse").expect("hashed");
        let source = format!(
            "categories: not a list\nusers:\n  - name: Ana\n    email: ana@example.com\n    passwordHash: \"{hash}\"\n  - name: Bo\n    email: Bo@Example.com\n    oidcSubject: \"248289761001\"\n"
        );
        let users = User::list(&source).expect("the users are valid");

        assert_eq!(users[0].name, "Ana");
        assert!(
            users[0]
                .password_hash
                .as_ref()
                .is_some_and(|hash| hash.verify("correct horse"))
        );
        assert_eq!(users[0].oidc_subject, None);
        assert!(users[1].has_email("bo@example.com"));
        assert_eq!(users[1].password_hash, None);
        assert_eq!(users[1].oidc_subject.as_deref(), Some("248289761001"));
    }

    #[test]
    fn rejects_a_user_without_a_name_or_with_no_email() {
        for (entry, field) in [
            ("{ email: ana@example.com }", "users[0].name"),
            ("{ name: '', email: ana@example.com }", "users[0].name"),
            ("{ name: Ana }", "users[0].email"),
        ] {
            let source = format!("users:\n  - {entry}\n");

            assert_eq!(invalid(&source).0, field, "{entry}");
        }
    }

    #[test]
    fn rejects_what_is_no_email() {
        for email in [
            "ana",
            "@example.com",
            "ana@",
            "ana@b@example.com",
            "ana @example.com",
            "",
        ] {
            let source = format!("users:\n  - {{ name: Ana, email: '{email}' }}\n");

            assert_eq!(
                invalid(&source),
                ("users[0].email".to_owned(), "must be an email".to_owned()),
                "{email:?}"
            );
        }
    }

    #[test]
    fn rejects_a_password_hash_that_hangar_user_hash_did_not_print() {
        for hash in ["hunter22", "$2b$12$abcdefghijklmnopqrstuv"] {
            let source = format!(
                "users:\n  - {{ name: Ana, email: ana@example.com, passwordHash: '{hash}' }}\n"
            );
            let (field, message) = invalid(&source);

            assert_eq!(field, "users[0].passwordHash", "{hash}");
            assert!(message.contains("argon2id"), "{message}");
        }
    }

    #[test]
    fn rejects_an_email_or_a_subject_listed_twice() {
        assert_eq!(
            invalid(
                "users:\n  - { name: Ana, email: ana@example.com }\n  - { name: Ana, email: ANA@example.com }\n"
            ),
            (
                "users[1].email".to_owned(),
                "ANA@example.com is listed twice".to_owned()
            )
        );
        assert_eq!(
            invalid(
                "users:\n  - { name: Ana, email: ana@example.com, oidcSubject: '1' }\n  - { name: Bo, email: bo@example.com, oidcSubject: '1' }\n"
            )
            .0,
            "users[1].oidcSubject"
        );
    }

    #[test]
    fn rejects_null_and_what_is_no_mapping() {
        assert_eq!(invalid("users:\n").0, "users");
        assert_eq!(invalid("- users\n").0, ".");
        assert!(matches!(
            User::list("users: ["),
            Err(ConfigError::Syntax(_))
        ));
    }
}
