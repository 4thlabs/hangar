//! Where a file of an app really is, once its path is known to stay in the app's folder.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

use crate::store::{Disk, StoreError};

/// A file of an app, its symlinks resolved, and the app's folder, resolved too: a write lands where the check
/// looked.
#[derive(Debug)]
pub(super) struct Location {
    /// The app's folder.
    pub(super) folder: PathBuf,
    /// The file, in the app's folder; it may not exist yet.
    pub(super) file: PathBuf,
}

impl Location {
    /// Where `path`, a file's path in the folder `folder` of the app `app`, really is: no NUL byte, not absolute, no
    /// empty segment, none that starts with a dot, which covers `.`, `..` and the files the listing hides, nothing
    /// that goes through a file, and no symlink out of the folder. A file that does not exist yet is placed under its
    /// closest folder that does.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidPath`], [`StoreError::ThroughFile`], [`StoreError::BrokenSymlink`] or
    /// [`StoreError::OutsideApp`] for a path that breaks those rules, and [`StoreError::Io`] when the folder or the
    /// path cannot be resolved.
    pub(super) async fn find(app: &str, folder: &Path, path: &str) -> Result<Self, StoreError> {
        let segments: Vec<&str> = path.split('/').collect();
        let is_malformed = path.contains('\0')
            || Path::new(path).is_absolute()
            || segments
                .iter()
                .any(|segment| segment.is_empty() || segment.starts_with('.'));

        if is_malformed {
            return Err(StoreError::InvalidPath {
                path: path.to_owned(),
            });
        }

        let real_folder = tokio::fs::canonicalize(folder)
            .await
            .map_err(|error| StoreError::io("resolve", folder, error))?;
        let joined = segments
            .iter()
            .fold(folder.to_owned(), |joined, segment| joined.join(segment));
        let real_file = Self::real_path(folder, &joined, path).await?;

        // By component: `/store/web-2` is not in `/store/web`.
        if !real_file.starts_with(&real_folder) {
            return Err(StoreError::OutsideApp {
                app: app.to_owned(),
                path: path.to_owned(),
            });
        }

        Ok(Self {
            folder: real_folder,
            file: real_file,
        })
    }

    /// Whether the file is the app's `name`, one of its compose files, which Docker must accept: reached through a
    /// symlink, as `alias.yml`, or spelled in another case, as `Compose.yml`, which a file system that ignores case
    /// takes for the same file.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`find`](Self::find) for `name` in the folder, as a broken symlink.
    pub(super) async fn is_root_file(&self, name: &str) -> Result<bool, StoreError> {
        let root = Self::real_path(&self.folder, &self.folder.join(name), name).await?;
        let is_at_root = self.file.parent() == Some(self.folder.as_path());
        let is_spelled_so = self
            .file
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .is_some_and(|file_name| file_name.to_lowercase() == name);

        Ok(self.file == root || (is_at_root && is_spelled_so))
    }

    /// The real path of `target`, in `folder`, or while it does not exist yet, the real path of its closest folder
    /// that does, joined with the rest. A dangling symlink is refused: writing through it would create its target,
    /// wherever it points. `path` is the target's path in the folder, which the errors name.
    async fn real_path(folder: &Path, target: &Path, path: &str) -> Result<PathBuf, StoreError> {
        let through_file = || StoreError::ThroughFile {
            path: path.to_owned(),
        };
        let mut missing: Vec<OsString> = Vec::new();
        let mut current = target.to_owned();

        loop {
            match tokio::fs::canonicalize(&current).await {
                Ok(real) => {
                    let real = missing
                        .iter()
                        .rev()
                        .fold(real, |real, name| real.join(name));

                    return Ok(real);
                }
                Err(error) if error.kind() == io::ErrorKind::NotADirectory => {
                    return Err(through_file());
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(StoreError::io("resolve", current, error)),
            }

            match tokio::fs::symlink_metadata(&current).await {
                Ok(metadata) if metadata.is_symlink() => {
                    return Err(StoreError::BrokenSymlink {
                        path: Self::relative(folder, &current),
                    });
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotADirectory => {
                    return Err(through_file());
                }
                Err(error) if Disk::is_missing(&error) => {}
                Err(error) => return Err(StoreError::io("inspect", current, error)),
            }

            let (Some(parent), Some(name)) = (current.parent(), current.file_name()) else {
                return Err(StoreError::io(
                    "resolve",
                    target,
                    io::Error::from(io::ErrorKind::NotFound),
                ));
            };

            missing.push(name.to_owned());
            current = parent.to_owned();
        }
    }

    /// `path`, under `folder`, as a path in it, with `/` between its segments.
    fn relative(folder: &Path, path: &Path) -> String {
        let relative = path.strip_prefix(folder).unwrap_or(path);

        relative
            .iter()
            .map(|segment| segment.to_string_lossy())
            .collect::<Vec<_>>()
            .join("/")
    }
}
