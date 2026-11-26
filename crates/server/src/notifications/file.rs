//! The file the notifications are kept in, `app-data/hangar/notifications.json`: read once as the server starts, and
//! replaced whole at each change, written beside it then renamed in its place, so that a crash never leaves it half
//! written. A file that cannot be read is put aside rather than replaced.

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

    /// The list the file holds; a new one, of an epoch of its own, when there is no file. A file that cannot be read
    /// as a list, not there as a file, unreadable, or not the JSON of one, is put aside, as
    /// `notifications.json.<time>.bad`, for its owner to read, and a new list starts; both are logged.
    pub(super) async fn read(&self) -> NotificationList {
        let read = match tokio::fs::read(&self.path).await {
            Ok(json) => NotificationList::from_json(&json).map_err(io::Error::other),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return NotificationList::new();
            }
            Err(error) => Err(error),
        };

        match read {
            Ok(list) => list,
            Err(error) => {
                self.put_aside(&error).await;
                NotificationList::new()
            }
        }
    }

    /// Moves the file aside, as `notifications.json.<time>.bad`, which `error` says cannot be read as a list.
    async fn put_aside(&self, error: &io::Error) {
        // `:` is fine on Linux but not everywhere, and these names are read by humans.
        let stamp = format!("{:.3}", jiff::Timestamp::now()).replace(':', "-");
        let aside = self.free_name(&stamp).await;

        match tokio::fs::rename(&self.path, &aside).await {
            Ok(()) => tracing::error!(
                path = %self.path.display(),
                aside = %aside.display(),
                %error,
                "the notifications' file cannot be read as a list: put aside, and a new list starts"
            ),
            Err(rename_error) => tracing::error!(
                path = %self.path.display(),
                %error,
                %rename_error,
                "the notifications' file cannot be read as a list, and could not be put aside: a new list starts, \
                 which replaces it at its first change"
            ),
        }
    }

    /// `notifications.json.<stamp>.bad`, with a number after the stamp when a file of that name is there already, so
    /// that a file put aside never replaces another.
    async fn free_name(&self, stamp: &str) -> PathBuf {
        let mut attempt = 1;

        loop {
            let name = match attempt {
                1 => format!("json.{stamp}.bad"),
                _ => format!("json.{stamp}-{attempt}.bad"),
            };
            let aside = self.path.with_extension(name);

            // A name that cannot be checked is tried: the rename then says why it fails.
            if !tokio::fs::try_exists(&aside).await.unwrap_or(false) {
                return aside;
            }

            attempt += 1;
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

    fn file(dir: &tempfile::TempDir) -> NotificationFile {
        NotificationFile::new(&DataDir::new(dir.path()).expect("a data directory"))
    }

    /// The names of the folder of the file, but its own.
    fn beside(file: &NotificationFile) -> Vec<String> {
        std::fs::read_dir(file.path().parent().expect("a folder"))
            .expect("listed")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .into_string()
                    .expect("UTF-8")
            })
            .filter(|name| name != "notifications.json")
            .collect()
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
        let mut list = file.read().await;

        assert_eq!(list.newest(1), [], "no file, no notification");

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

        let read = file.read().await;

        assert_eq!(read.newest(1), list.newest(1));
        assert_eq!(read.epoch(), list.epoch());
        assert_eq!(beside(&file), Vec::<String>::new(), "nothing left beside");
    }

    #[tokio::test]
    async fn puts_aside_each_file_that_is_not_a_list_under_a_name_of_its_own_and_starts_a_new_epoch()
     {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let file = file(&dir);
        let mut epochs = Vec::new();

        std::fs::create_dir_all(file.path().parent().expect("a folder")).expect("created");

        for contents in [
            &b"{ broken"[..],
            b"{ \"epoch\": \"\xff\", \"nextId\": 1, \"notifications\": [] }",
        ] {
            std::fs::write(file.path(), contents).expect("written");

            let list = file.read().await;

            assert_eq!(list.newest(1), []);
            assert!(!file.path().exists());
            epochs.push(list.epoch().to_owned());
        }

        let mut aside = beside(&file);

        aside.sort();

        assert_eq!(aside.len(), 2, "{aside:?}");
        assert!(
            aside
                .iter()
                .all(|name| name.starts_with("notifications.json.") && name.ends_with(".bad"))
        );
        assert_ne!(epochs[0], epochs[1]);
    }

    #[tokio::test]
    async fn puts_aside_a_file_it_cannot_read() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let file = file(&dir);

        // A folder in its place: a read fails, as one of a file the server may not read does.
        std::fs::create_dir_all(file.path()).expect("created");

        assert_eq!(file.read().await.newest(1), []);
        assert!(!file.path().exists(), "put aside, not saved over");
        assert_eq!(beside(&file).len(), 1);
    }
}
