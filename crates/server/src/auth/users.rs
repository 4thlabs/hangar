//! The users of `hangar.yml`, read again at each sign-in and each request, so that a user removed is signed out.

use std::sync::{Arc, Mutex, PoisonError};

use hangar_core::{Config, Runtime, Store, User};

/// The users the store's `hangar.yml` lists.
///
/// The file is read at each call: a user added can sign in at once, and one removed, whose cookie is still signed, is
/// refused at their next request, which a signed cookie alone cannot do. Reading and parsing a small file costs less
/// than a millisecond. When the file is broken, by a pull that brought an invalid one, the users of the last file
/// that read are kept, so that whoever can fix it from the page is not locked out; nobody signs in when no file has
/// read since the start.
#[derive(Debug)]
pub(crate) struct Users {
    store: Store<Runtime>,
    last: Mutex<Arc<[User]>>,
}

impl Users {
    /// The users of `store`'s `hangar.yml`.
    pub(crate) fn new(store: Store<Runtime>) -> Self {
        Self {
            store,
            last: Mutex::new(Arc::from([])),
        }
    }

    /// The users listed now, or those of the last file that read.
    pub(crate) async fn current(&self) -> Arc<[User]> {
        match self.read().await {
            Ok(users) => {
                let users: Arc<[User]> = Arc::from(users);

                *self.last.lock().unwrap_or_else(PoisonError::into_inner) = Arc::clone(&users);
                users
            }
            Err(error) => {
                tracing::warn!("hangar.yml cannot be read, its last users are kept: {error}");

                Arc::clone(&self.last.lock().unwrap_or_else(PoisonError::into_inner))
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

        Config::parse(&source)
            .map(|config| config.users)
            .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use hangar_core::{DataDir, Runtime, Store};

    use super::Users;

    /// The users of a data directory whose `hangar.yml` is `source`, if any.
    fn users(dir: &tempfile::TempDir) -> Users {
        let data_dir = DataDir::new(dir.path()).expect("a data directory");

        Users::new(Store::new(String::new(), data_dir, Runtime::new()))
    }

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
    async fn keeps_the_last_users_when_the_file_breaks() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let users = users(&dir);

        write(
            &dir,
            "categories: []\nusers:\n  - { name: Ana, email: ana@example.com }\n",
        );
        users.current().await;
        write(&dir, "categories: [");

        assert!(users.find("ana@example.com").await.is_some());
    }
}
