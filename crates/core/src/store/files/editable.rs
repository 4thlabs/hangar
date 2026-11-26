//! The files of an app's folder the editor may open: regular UTF-8 text files, small enough to be sent to a browser
//! whole. The paths given here are resolved already, and known to stay in the app's folder.

use std::io;
use std::path::Path;

use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::store::StoreError;

/// An entry of an app's folder that the listing met, by its path in the folder.
struct ListedEntry {
    path: String,
    is_file: bool,
    is_folder: bool,
}

/// The editor's reads and writes of one file.
pub(super) struct EditableFile;

impl EditableFile {
    /// The largest file the editor opens: it is sent to the browser whole, and saved back the same way.
    pub(super) const MAX_SIZE: u64 = 1024 * 1024;

    /// How much of a file is read to tell text from binary, as much as git reads.
    const SNIFF_LENGTH: u64 = 8000;

    /// How many folders deep a listing goes: an app may bind-mount its data, `./data`, into its folder.
    const MAX_DEPTH: usize = 5;

    /// How many files a listing reads at most, for the same reason.
    const MAX_FILES: usize = 500;

    /// The editable files under `folder`, as paths in it, sorted. Hidden entries, symlinks, binaries and files over
    /// the size limit are left out, and so is what cannot be read, with a warning: one entry that cannot be read does
    /// not hide the others.
    pub(super) async fn list(folder: &Path) -> Vec<String> {
        let mut files = Vec::new();

        // One file at a time: a listing may hold hundreds, more than the files a process may open.
        for path in Self::candidates(folder).await {
            if Self::is_listed(folder, &path).await {
                files.push(path);
            }
        }

        files.sort();
        files
    }

    /// The text of `file`, the app `app`'s file at `path`.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::NoSuchFile`] when it is not there, [`StoreError::NotAFile`], [`StoreError::TooLarge`],
    /// [`StoreError::Binary`] and [`StoreError::NotUtf8Text`] for a file the editor does not open, and
    /// [`StoreError::Io`] when it cannot be read.
    pub(super) async fn read(file: &Path, app: &str, path: &str) -> Result<String, StoreError> {
        let mut handle = match Self::reading().open(file).await {
            Ok(handle) => handle,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(StoreError::NoSuchFile {
                    app: app.to_owned(),
                    path: path.to_owned(),
                });
            }
            Err(error) => return Err(Self::open_error(error, file, path)),
        };
        let metadata = handle
            .metadata()
            .await
            .map_err(|error| StoreError::io("inspect", file, error))?;

        if !metadata.is_file() {
            return Err(Self::not_a_file(path));
        }

        if metadata.len() > Self::MAX_SIZE {
            return Err(StoreError::TooLarge {
                path: path.to_owned(),
                size: metadata.len(),
            });
        }

        let mut content = Vec::new();

        handle
            .read_to_end(&mut content)
            .await
            .map_err(|error| StoreError::io("read", file, error))?;

        if Self::is_binary(&content) {
            return Err(StoreError::Binary {
                path: path.to_owned(),
            });
        }

        // A byte order mark is kept, so that a save writes it back.
        String::from_utf8(content).map_err(|_| StoreError::NotUtf8Text {
            path: path.to_owned(),
        })
    }

    /// Writes `source` to `file`, the file at `path`, creating it and its missing folders when it is not there yet.
    /// A file that is there is rewritten in place: a container that bind-mounts that one file holds its inode, and sees
    /// an edit made to that inode alone, not a new file renamed over it.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::NotAFile`] when it is not a regular file, a symlink swapped in after its path was
    /// resolved included, [`StoreError::FileAppeared`] when something took its place as it was created, and
    /// [`StoreError::Io`] when it cannot be written.
    pub(super) async fn write(file: &Path, path: &str, source: &str) -> Result<(), StoreError> {
        let mut options = Self::rewriting();

        // No `create`: nothing is created through a symlink planted after the path was resolved.
        options.write(true);

        let mut handle = match options.open(file).await {
            Ok(handle) => Self::regular(handle, file, path).await?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Self::create_new(file, path, || StoreError::FileAppeared {
                    path: path.to_owned(),
                })
                .await?
            }
            Err(error) => return Err(Self::open_error(error, file, path)),
        };
        let written = async {
            handle.set_len(0).await?;
            handle.write_all(source.as_bytes()).await?;
            handle.flush().await
        };

        written
            .await
            .map_err(|error| StoreError::io("write", file, error))
    }

    /// Creates `file`, the file at `path`, empty, and its missing folders.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::FileExists`] when anything is at that path, whatever it is, and [`StoreError::Io`] when
    /// it cannot be created.
    pub(super) async fn create(file: &Path, path: &str) -> Result<(), StoreError> {
        Self::create_new(file, path, || StoreError::FileExists {
            path: path.to_owned(),
        })
        .await
        .map(drop)
    }

    /// `file` created, with its missing folders: an exclusive create refuses an entry there, a symlink or a file the
    /// listing hides included, as `taken` says, where a check first would leave a gap before the write.
    async fn create_new(
        file: &Path,
        path: &str,
        taken: impl FnOnce() -> StoreError,
    ) -> Result<File, StoreError> {
        if let Some(parent) = file.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| StoreError::io("create", parent, error))?;
        }

        let mut options = OpenOptions::new();

        options.write(true).create_new(true);

        match options.open(file).await {
            Ok(handle) => Ok(handle),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(taken()),
            Err(error) => Err(Self::open_error(error, file, path)),
        }
    }

    /// `handle`, checked to be a regular file through itself, so that the file written is the one checked.
    async fn regular(handle: File, file: &Path, path: &str) -> Result<File, StoreError> {
        let metadata = handle
            .metadata()
            .await
            .map_err(|error| StoreError::io("inspect", file, error))?;

        if !metadata.is_file() {
            return Err(Self::not_a_file(path));
        }

        Ok(handle)
    }

    /// The options of a read: no blocking on a FIFO, and no following a symlink swapped in after the path was
    /// resolved.
    fn reading() -> OpenOptions {
        let mut options = Self::rewriting();

        options.read(true);
        options
    }

    /// The options of a write in place, before its access is set: those of a read.
    fn rewriting() -> OpenOptions {
        #[cfg_attr(not(unix), expect(unused_mut, reason = "the flags are Unix's alone"))]
        let mut options = OpenOptions::new();

        #[cfg(unix)]
        options.custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK);

        options
    }

    /// The error of an open of `file`, at `path`, that failed: a symlink refused rather than followed, a folder, or a
    /// FIFO no one reads, is not a file.
    fn open_error(error: io::Error, file: &Path, path: &str) -> StoreError {
        #[cfg(unix)]
        let is_special = matches!(
            error.raw_os_error(),
            Some(nix::libc::ELOOP | nix::libc::ENXIO)
        );
        #[cfg(not(unix))]
        let is_special = false;

        if is_special || error.kind() == io::ErrorKind::IsADirectory {
            return Self::not_a_file(path);
        }

        StoreError::io("open", file, error)
    }

    /// The refusal of `path`, which is not a regular file.
    fn not_a_file(path: &str) -> StoreError {
        StoreError::NotAFile {
            path: path.to_owned(),
        }
    }

    /// Whether `content` is binary, by git's rule: a NUL byte in its first kilobytes.
    fn is_binary(content: &[u8]) -> bool {
        let sniffed = content.len().min(Self::SNIFF_LENGTH as usize);

        content[..sniffed].contains(&0)
    }

    /// The visible regular files under `folder`, breadth first, within the listing's depth and count.
    async fn candidates(folder: &Path) -> Vec<String> {
        let mut files = Vec::new();
        let mut folders = vec![String::new()];

        for _ in 0..=Self::MAX_DEPTH {
            if folders.is_empty() {
                break;
            }

            let mut next = Vec::new();

            for relative in &folders {
                for entry in Self::visible_entries(folder, relative).await {
                    if entry.is_file {
                        files.push(entry.path);
                    } else if entry.is_folder {
                        next.push(entry.path);
                    }
                }
            }

            folders = next;

            if files.len() >= Self::MAX_FILES {
                break;
            }
        }

        if !folders.is_empty() || files.len() > Self::MAX_FILES {
            tracing::warn!(
                folder = %folder.display(),
                max_depth = Self::MAX_DEPTH,
                max_files = Self::MAX_FILES,
                "an app's folder is listed only in part"
            );
        }

        files.truncate(Self::MAX_FILES);
        files
    }

    /// The entries of the folder `relative`, in `folder`, that the listing may show: not hidden, and named in UTF-8,
    /// as a path the page sends back must be. None when the folder cannot be read, which is logged.
    async fn visible_entries(folder: &Path, relative: &str) -> Vec<ListedEntry> {
        let path = folder.join(relative);
        let mut reader = match tokio::fs::read_dir(&path).await {
            Ok(reader) => reader,
            Err(error) => {
                tracing::warn!(folder = %path.display(), %error, "skipping a folder of an app that cannot be read");

                return Vec::new();
            }
        };
        let mut entries = Vec::new();

        loop {
            let entry = match reader.next_entry().await {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(folder = %path.display(), %error, "skipping the rest of a folder of an app");
                    break;
                }
            };
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };

            if name.starts_with('.') {
                continue;
            }

            // The entry itself, its symlink not followed: a symlink is neither.
            let file_type = match entry.file_type().await {
                Ok(file_type) => file_type,
                Err(error) => {
                    tracing::warn!(entry = %entry.path().display(), %error, "skipping an entry of an app that cannot be read");
                    continue;
                }
            };
            let path = if relative.is_empty() {
                name
            } else {
                format!("{relative}/{name}")
            };

            entries.push(ListedEntry {
                path,
                is_file: file_type.is_file(),
                is_folder: file_type.is_dir(),
            });
        }

        entries
    }

    /// Whether the listing shows the file at `path`; one that cannot be read is left out, and logged.
    async fn is_listed(folder: &Path, path: &str) -> bool {
        let file = folder.join(path);

        match Self::is_small_text_file(&file).await {
            Ok(is_listed) => is_listed,
            Err(error) => {
                tracing::warn!(file = %file.display(), %error, "skipping a file of an app that cannot be read");

                false
            }
        }
    }

    /// Whether `file` is a regular file within the size limit, and text by git's rule.
    async fn is_small_text_file(file: &Path) -> io::Result<bool> {
        let handle = Self::reading().open(file).await?;
        let metadata = handle.metadata().await?;

        if !metadata.is_file() || metadata.len() > Self::MAX_SIZE {
            return Ok(false);
        }

        let mut head = Vec::new();

        handle
            .take(Self::SNIFF_LENGTH)
            .read_to_end(&mut head)
            .await?;

        Ok(!Self::is_binary(&head))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::symlink;

    use super::EditableFile;
    use crate::StoreError;

    #[tokio::test]
    async fn refuses_a_symlink_swapped_in_after_the_path_was_resolved_rather_than_follow_it() {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let secret = dir.path().join("secret.txt");
        let link = dir.path().join("settings.yml");

        std::fs::write(&secret, "the secret\n").expect("written");
        symlink(&secret, &link).expect("linked");

        let read = EditableFile::read(&link, "web", "settings.yml")
            .await
            .expect_err("refused");
        let write = EditableFile::write(&link, "settings.yml", "a: 1\n")
            .await
            .expect_err("refused");

        for error in [read, write] {
            assert!(matches!(error, StoreError::NotAFile { .. }), "{error:?}");
        }

        assert_eq!(
            std::fs::read_to_string(&secret).expect("reads"),
            "the secret\n"
        );
        assert!(
            EditableFile::list(dir.path())
                .await
                .contains(&"secret.txt".to_owned())
        );
        assert!(
            !EditableFile::list(dir.path())
                .await
                .contains(&"settings.yml".to_owned())
        );
    }

    #[tokio::test]
    async fn refuses_a_fifo_without_waiting_for_a_writer() {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let fifo = dir.path().join("pipe.yml");

        nix::unistd::mkfifo(&fifo, nix::sys::stat::Mode::S_IRWXU).expect("a FIFO can be made");

        let read = EditableFile::read(&fifo, "web", "pipe.yml")
            .await
            .expect_err("refused");
        let write = EditableFile::write(&fifo, "pipe.yml", "a: 1\n")
            .await
            .expect_err("refused");

        for error in [read, write] {
            assert!(matches!(error, StoreError::NotAFile { .. }), "{error:?}");
        }

        assert!(EditableFile::list(dir.path()).await.is_empty());
    }
}
