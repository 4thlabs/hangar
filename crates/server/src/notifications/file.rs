//! The file the notifications are kept in, `app-data/hangar/notifications.json`: read once as the server starts, and
//! replaced whole at each change, written beside it then renamed in its place, so that a crash never leaves it half
//! written.

use std::io;
use std::path::{Path, PathBuf};

use hangar_core::DataDir;
use tokio::io::AsyncWriteExt;

use super::list::NotificationList;

/// The file of the notifications of a data directory.
#[derive(Debug, Clone)]
pub(super) struct NotificationFile {
    path: PathBuf,
}

impl NotificationFile {
    /// The file of `data_dir`'s, in the folder of Hangar's own data, beside those of the apps.
    pub(super) fn new(data_dir: &DataDir) -> Self {
        Self {
            path: data_dir
                .app_data()
                .join("hangar")
                .join("notifications.json"),
        }
    }

    /// Its path.
    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    /// The list the file holds; none when there is no file. A file that is not a list is put aside, as
    /// `notifications.json.bad`, for its owner to read, and the list starts empty; a file that cannot be read starts
    /// it empty too. Both are logged.
    ///
    /// Read as the server starts, before it serves: the file is small, and nothing waits on it then.
    pub(super) fn read(&self) -> NotificationList {
        let json = match std::fs::read_to_string(&self.path) {
            Ok(json) => json,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return NotificationList::default();
            }
            Err(error) => {
                tracing::error!(
                    path = %self.path.display(),
                    %error,
                    "the notifications could not be read: the list starts empty"
                );
                return NotificationList::default();
            }
        };

        match NotificationList::from_json(&json) {
            Ok(list) => list,
            Err(error) => {
                self.put_aside(&error);
                NotificationList::default()
            }
        }
    }

    /// Moves the file aside, as `notifications.json.bad`, which `error` says it is not a list.
    fn put_aside(&self, error: &serde_json::Error) {
        let aside = self.path.with_extension("json.bad");
        let moved = std::fs::rename(&self.path, &aside);

        match moved {
            Ok(()) => tracing::error!(
                path = %self.path.display(),
                aside = %aside.display(),
                %error,
                "the notifications' file is not a list: put aside, and the list starts empty"
            ),
            Err(rename_error) => tracing::error!(
                path = %self.path.display(),
                %error,
                %rename_error,
                "the notifications' file is not a list, and could not be put aside: the list starts empty, and \
                 replaces it at its first change"
            ),
        }
    }

    /// Replaces the file with one holding `contents`, written beside it, flushed to the disk, then renamed in its
    /// place, its folder made first.
    ///
    /// # Errors
    ///
    /// The error of the folder, of the file written beside, or of the rename: the file is then as it was.
    pub(super) async fn write(&self, contents: &[u8]) -> io::Result<()> {
        let folder = self
            .path
            .parent()
            .expect("the file sits in a folder of the data directory");
        let written = folder.join(format!(".notifications.json.{}.tmp", std::process::id()));

        tokio::fs::create_dir_all(folder).await?;

        if let Err(error) = Self::write_new(&written, contents).await {
            Self::discard(&written).await;

            return Err(error);
        }

        if let Err(error) = tokio::fs::rename(&written, &self.path).await {
            Self::discard(&written).await;

            return Err(error);
        }

        Ok(())
    }

    /// Writes `contents` to `path`, flushed to the disk. One left by a crash is removed first, and the file is
    /// created new, so that a link planted under its name is not written through.
    async fn write_new(path: &Path, contents: &[u8]) -> io::Result<()> {
        match tokio::fs::remove_file(path).await {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }

        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .await?;

        file.write_all(contents).await?;
        file.sync_all().await
    }

    /// Removes the file written beside, which a failure left; a failure to is logged.
    async fn discard(path: &Path) {
        match tokio::fs::remove_file(path).await {
            Err(error) if error.kind() != io::ErrorKind::NotFound => tracing::warn!(
                path = %path.display(),
                %error,
                "a copy of the notifications' file could not be removed"
            ),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use hangar_api::{NotificationLevel, NotificationMessage};
    use hangar_core::DataDir;

    use super::NotificationFile;
    use crate::notifications::Notification;
    use crate::notifications::list::NotificationList;

    fn file(dir: &tempfile::TempDir) -> NotificationFile {
        NotificationFile::new(&DataDir::new(dir.path()).expect("a data directory"))
    }

    #[test]
    fn lives_in_hangar_s_own_folder_of_app_data() {
        let dir = tempfile::tempdir().expect("a temporary directory");

        assert_eq!(
            file(&dir).path(),
            dir.path().join("app-data/hangar/notifications.json")
        );
    }

    #[tokio::test]
    async fn writes_the_list_whole_and_reads_it_back() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let file = file(&dir);
        let mut list = NotificationList::default();

        assert_eq!(file.read().newest(1), [], "no file, no notification");

        list.file(
            Notification {
                level: NotificationLevel::Error,
                message: NotificationMessage::StoreUpdateFailed,
                href: None,
                dedupe_key: None,
            },
            "2026-11-26T10:00:00.000Z".to_owned(),
        );
        file.write(&list.to_json()).await.expect("written");
        file.write(&list.to_json()).await.expect("written again");

        assert_eq!(file.read().newest(1), list.newest(1));
        assert_eq!(
            std::fs::read_dir(file.path().parent().expect("a folder"))
                .expect("listed")
                .count(),
            1,
            "nothing left beside"
        );
    }

    #[test]
    fn puts_aside_a_file_that_is_not_a_list() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let file = file(&dir);

        std::fs::create_dir_all(file.path().parent().expect("a folder")).expect("created");
        std::fs::write(file.path(), "{ broken").expect("written");

        assert_eq!(file.read().newest(1), []);
        assert!(!file.path().exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("app-data/hangar/notifications.json.bad"))
                .expect("put aside"),
            "{ broken"
        );
    }
}
