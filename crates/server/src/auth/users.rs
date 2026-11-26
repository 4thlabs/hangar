//! The users of `hangar.yml`, read again at each sign-in and each request, so that a user removed is signed out.

use std::sync::Arc;

use hangar_core::{Runtime, Store, User};

/// The users the store's `hangar.yml` lists.
///
/// The file is read at each call: a user added can sign in at once, and one removed, or whose credentials changed,
/// is refused at their next request, which a signed cookie alone cannot do. Reading a small file costs less than a
/// millisecond.
///
/// The users are read apart from the rest of the file, with [`User::list`]: a mistake among them leaves the store's
/// other readers, the CLI, compose and the editor, working. The server then signs nobody in, and logs why, until the
/// file is fixed: it never guesses which users a broken list meant.
#[derive(Debug)]
pub(crate) struct Users {
    store: Store<Runtime>,
}

impl Users {
    /// The users of `store`'s `hangar.yml`.
    pub(crate) fn new(store: Store<Runtime>) -> Self {
        Self { store }
    }

    /// The users listed now; none while the file cannot be read, or its users are wrong.
    pub(crate) async fn current(&self) -> Arc<[User]> {
        match self.read().await {
            Ok(users) => Arc::from(users),
            Err(error) => {
                tracing::error!(
                    "the users of hangar.yml cannot be read, nobody can sign in: {error}"
                );

                Arc::from([])
            }
        }
    }

    /// The user whose email is `email`, whatever its case.
    pub(crate) async fn find(&self, email: &str) -> Option<User> {
        self.current()
            .await
            .iter()
            .find(|user| user.has_email(email))
            .cloned()
    }

    /// The users of the file, none when the store has no `hangar.yml` yet.
    async fn read(&self) -> Result<Vec<User>, String> {
        let source = self
            .store
            .config_source()
            .await
            .map_err(|error| error.to_string())?;

        if source.is_empty() {
            return Ok(Vec::new());
        }

        User::list(&source).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use hangar_core::{DataDir, Runtime, Store};

    use super::Users;

    /// The users of the data directory at `dir`.
    fn users(dir: &tempfile::TempDir) -> Users {
        let data_dir = DataDir::new(dir.path()).expect("a data directory");

        Users::new(Store::new(String::new(), data_dir, Runtime::new()))
    }

    /// Writes `source` to the `hangar.yml` of `dir`.
    fn write(dir: &tempfile::TempDir, source: &str) {
        let data_dir = DataDir::new(dir.path()).expect("a data directory");
        let file = data_dir.config_file();

        std::fs::create_dir_all(file.parent().expect("a folder")).expect("created");
        std::fs::write(file, source).expect("written");
    }

    #[tokio::test]
    async fn lists_nobody_without_a_hangar_yml() {
        let dir = tempfile::tempdir().expect("a temporary directory");

        assert!(users(&dir).current().await.is_empty());
    }

    #[tokio::test]
    async fn reads_the_file_again_at_each_call() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let users = users(&dir);

        write(
            &dir,
            "categories: []\nusers:\n  - { name: Ana, email: ana@example.com }\n",
        );

        assert_eq!(
            users.find("ANA@example.com").await.map(|user| user.name),
            Some("Ana".to_owned())
        );

        write(&dir, "categories: []\n");

        assert_eq!(users.find("ana@example.com").await, None);
    }

    #[tokio::test]
    async fn signs_nobody_in_while_a_user_is_wrong() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let users = users(&dir);

        write(
            &dir,
            "categories: []\nusers:\n  - { name: Ana, email: ana@example.com }\n  - { name: Bo, email: bo }\n",
        );

        assert!(users.find("ana@example.com").await.is_none());
    }

    #[tokio::test]
    async fn reads_the_users_whatever_the_rest_of_the_file_holds() {
        let dir = tempfile::tempdir().expect("a temporary directory");

        write(
            &dir,
            "categories: 3\nusers:\n  - { name: Ana, email: ana@example.com }\n",
        );

        assert!(users(&dir).find("ana@example.com").await.is_some());
    }
}
