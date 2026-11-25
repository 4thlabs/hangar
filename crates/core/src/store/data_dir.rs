//! The data directory, where Hangar keeps the store, the installed apps, their data and the global environment.

use std::path::{Component, Path, PathBuf};

use super::StoreError;

/// The data directory and the paths in it, the same as the Waku version's, so that both run on one directory:
///
/// ```text
/// <root>/
/// ├── .env.global          # the variables every stack is composed with, and their timestamped .bak copies
/// ├── app-store/           # the clone of the store
/// │   ├── config/hangar.yml
/// │   └── store/<app>/compose.yml
/// ├── app-installed/       # one symlink per installed app, beside the shared files
/// ├── app-data/            # APP_DATA_DIR: where the stacks keep their data, one folder per app
/// └── app-backups/         # the backups of each app, one folder per app
/// ```
///
/// ```
/// use std::path::Path;
///
/// use hangar_core::DataDir;
///
/// let data_dir = DataDir::new("/srv/hangar/.data/../.data")?;
///
/// assert_eq!(data_dir.root(), Path::new("/srv/hangar/.data"));
/// assert_eq!(data_dir.installed(), Path::new("/srv/hangar/.data/app-installed"));
/// # Ok::<(), hangar_core::StoreError>(())
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDir {
    root: PathBuf,
    store: PathBuf,
    store_apps: PathBuf,
    config_file: PathBuf,
    installed: PathBuf,
    app_data: PathBuf,
    backups: PathBuf,
    env_file: PathBuf,
}

impl DataDir {
    /// The variable that names the data directory.
    pub const VARIABLE: &str = "HANGAR_DATA_DIR";

    /// The data directory at `root`, made absolute against the working directory and with its `.` and `..` resolved,
    /// as Node's `path.resolve` does.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Io`] when `root` is relative and the working directory cannot be read, and
    /// [`StoreError::NotUtf8`] when the path is not UTF-8: it is passed to `git` and `docker` as an argument.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let root = root.into();
        let absolute =
            std::path::absolute(&root).map_err(|error| StoreError::io("resolve", root, error))?;
        let root = Self::normalize(&absolute);

        if root.to_str().is_none() {
            return Err(StoreError::NotUtf8 { path: root });
        }

        Ok(Self {
            store: root.join("app-store"),
            store_apps: root.join("app-store").join("store"),
            config_file: root.join("app-store").join("config").join("hangar.yml"),
            installed: root.join("app-installed"),
            app_data: root.join("app-data"),
            backups: root.join("app-backups"),
            env_file: root.join(".env.global"),
            root,
        })
    }

    /// The data directory that `HANGAR_DATA_DIR` names, as [`new`](Self::new) resolves it.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DataDirNotSet`] when the variable is not set, empty or not Unicode, and the errors of
    /// [`new`](Self::new).
    pub fn from_env() -> Result<Self, StoreError> {
        let root = std::env::var(Self::VARIABLE).unwrap_or_default();

        if root.is_empty() {
            return Err(StoreError::DataDirNotSet);
        }

        Self::new(root)
    }

    /// The data directory itself.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The clone of the store's repository, `app-store`.
    pub fn store(&self) -> &Path {
        &self.store
    }

    /// The folder of the store's apps in its clone, `app-store/store`: one folder per app, beside the shared files.
    pub fn store_apps(&self) -> &Path {
        &self.store_apps
    }

    /// The store's configuration, `app-store/config/hangar.yml`.
    pub fn config_file(&self) -> &Path {
        &self.config_file
    }

    /// The installed apps, `app-installed`: one symlink per app into the store, beside the shared files.
    pub fn installed(&self) -> &Path {
        &self.installed
    }

    /// Where the stacks keep their data, one folder per app, `app-data`: the value of `APP_DATA_DIR`.
    pub fn app_data(&self) -> &Path {
        &self.app_data
    }

    /// Where the backups of each app are kept, one folder per app, `app-backups`.
    pub fn backups(&self) -> &Path {
        &self.backups
    }

    /// The global environment every stack is composed with, `.env.global`.
    pub fn env_file(&self) -> &Path {
        &self.env_file
    }

    /// `path` without its `.` and `..`, which climb from the root no further than the root, as in `path.resolve`;
    /// `std::path::absolute` keeps the `..`.
    fn normalize(path: &Path) -> PathBuf {
        let mut normalized = PathBuf::new();

        for component in path.components() {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                    normalized.push(component);
                }
            }
        }

        normalized
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::DataDir;

    #[test]
    fn makes_a_relative_directory_absolute_against_the_working_directory() {
        let data_dir =
            DataDir::new("data/./store-test/..").expect("the working directory is readable");
        let expected = std::env::current_dir()
            .expect("the working directory is readable")
            .join("data");

        assert_eq!(data_dir.root(), expected);
    }

    #[test]
    fn lays_out_the_paths_of_the_waku_version() {
        let data_dir = DataDir::new("/data/").expect("an absolute path resolves");

        assert_eq!(data_dir.root(), Path::new("/data"));
        assert_eq!(data_dir.store(), Path::new("/data/app-store"));
        assert_eq!(data_dir.store_apps(), Path::new("/data/app-store/store"));
        assert_eq!(
            data_dir.config_file(),
            Path::new("/data/app-store/config/hangar.yml")
        );
        assert_eq!(data_dir.installed(), Path::new("/data/app-installed"));
        assert_eq!(data_dir.app_data(), Path::new("/data/app-data"));
        assert_eq!(data_dir.backups(), Path::new("/data/app-backups"));
        assert_eq!(data_dir.env_file(), Path::new("/data/.env.global"));
    }

    #[test]
    fn climbs_no_further_than_the_root() {
        let data_dir = DataDir::new("/../../data").expect("an absolute path resolves");

        assert_eq!(data_dir.root(), Path::new("/data"));
    }
}
