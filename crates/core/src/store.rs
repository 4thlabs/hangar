//! The store: the git repository of the user's apps, cloned into the data directory, its `hangar.yml`, the apps
//! installed from it, and the global environment their stacks are composed with.
//!
//! Paths and file formats are the Waku version's, so that both run on one data directory: [`DataDir`] lays out the
//! paths, [`Config`] reads `hangar.yml` by the rules of its zod schema, [`GlobalEnv`] writes `.env.global` as it did,
//! and an installed app is a symlink in `app-installed/` to its folder in the clone, by its absolute path.
//!
//! ```no_run
//! # async fn example() -> Result<(), hangar_core::StoreError> {
//! use hangar_core::{DataDir, Output, Runtime, Store};
//!
//! let store = Store::new("https://example.com/store.git", DataDir::from_env()?, Runtime::new());
//!
//! // Clones the store, or pulls it, links the apps its categories list, and seeds `.env.global`.
//! store.install(Output::Inherit).await?;
//!
//! for app in store.apps().await? {
//!     println!("{} ({}): installed {}", app.name, app.id, app.installed);
//! }
//! # Ok(())
//! # }
//! ```

mod app;
mod app_id;
mod config;
mod data_dir;
mod disk;
mod env;
mod error;
mod files;
mod yaml;

use std::io;
use std::path::Path;

pub use app::StoreApp;
pub use config::{
    Backup, Category, Column, Config, ConfigError, FollowedCard, ServiceOptions, User, Widget,
    WidgetKind,
};
pub use data_dir::DataDir;
pub use env::{Dotenv, GlobalEnv};
pub use error::StoreError;
pub use files::{AppFiles, SavedFile};
pub use yaml::YamlError;

pub(crate) use disk::Disk;

use crate::{Command, CommandRunner, Output};
use app_id::AppId;
use disk::Access;
use yaml::Yaml;

/// The store of a data directory: its clone, its configuration, its apps and the global environment.
///
/// Each read is fresh: the store keeps nothing in memory, so that what another process, or the Waku version, wrote
/// meanwhile is seen. Caching belongs to the server.
#[derive(Debug)]
pub struct Store<R> {
    url: String,
    data_dir: DataDir,
    env: GlobalEnv,
    runner: R,
}

impl<R: CommandRunner> Store<R> {
    /// The store cloned from `url` into `data_dir`, cloned and pulled by `runner`. Reads nothing yet.
    pub fn new(url: impl Into<String>, data_dir: DataDir, runner: R) -> Self {
        Self {
            url: url.into(),
            env: GlobalEnv::new(&data_dir),
            data_dir,
            runner,
        }
    }

    /// The git URL of the store.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// The data directory.
    pub fn data_dir(&self) -> &DataDir {
        &self.data_dir
    }

    /// The global environment, `.env.global`.
    pub fn env(&self) -> &GlobalEnv {
        &self.env
    }

    /// Whether the store's repository has been cloned.
    pub async fn is_installed(&self) -> bool {
        Disk::exists(&self.data_dir.store().join(".git")).await
    }

    /// Installs the store, or updates it: clones its repository, or pulls it with `--ff-only` once it is there, with
    /// git's output going to `output`. Then links every app the categories list and the shared files, and adds to
    /// `.env.global` the variables the installed stacks reference: every compose call reads that file, so a fresh
    /// install leaves the operator the list of variables to fill.
    ///
    /// An app or a shared file that cannot be linked is logged, and the others are linked all the same.
    ///
    /// The pull fails once upstream changes a file changed in the clone, as `hangar.yml` is by
    /// [`save_config`](Self::save_config): git refuses to overwrite the local change, and the store stays as it was.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Git`] when git fails, [`StoreError::Config`] when `hangar.yml` is invalid, and
    /// [`StoreError::Io`] when `app-installed/` cannot be created or `.env.global` cannot be written.
    pub async fn install(&self, output: Output) -> Result<(), StoreError> {
        let installed = self.data_dir.installed();

        if !Disk::exists(installed).await {
            tokio::fs::create_dir_all(installed)
                .await
                .map_err(|error| StoreError::io("create", installed, error))?;
        }

        if self.is_installed().await {
            self.git(
                "pull",
                ["-C", Self::arg(self.data_dir.store()), "pull", "--ff-only"],
                output,
            )
            .await?;
        } else {
            self.git(
                "clone",
                [
                    "clone",
                    "--",
                    self.url.as_str(),
                    Self::arg(self.data_dir.store()),
                ],
                output,
            )
            .await?;
        }

        // The categories only exist once the clone brought hangar.yml in.
        let config = self.config().await?;

        self.link_all(&config).await;
        self.env.ensure().await?;

        Ok(())
    }

    /// The store's configuration, from `hangar.yml`. A store without one has no category, and every default: it still
    /// installs, its apps are just left ungrouped.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Config`] when the file is invalid, and [`StoreError::Io`] when it cannot be read.
    pub async fn config(&self) -> Result<Config, StoreError> {
        let file = self.data_dir.config_file();
        let Some(source) = self.read_config().await? else {
            tracing::warn!(path = %file.display(), "no Hangar config: the store declares no categories");

            return Ok(Config::default());
        };

        Config::parse(&source).map_err(|source| StoreError::Config {
            path: file.to_owned(),
            source,
        })
    }

    /// `hangar.yml` as it is written, empty when the store ships none.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Io`] when the file exists but cannot be read.
    pub async fn config_source(&self) -> Result<String, StoreError> {
        Ok(self.read_config().await?.unwrap_or_default())
    }

    /// Checks `source`, then writes it to `hangar.yml` as it is, creating `config/` for a store that ships none, and
    /// links what it lists, as [`install`](Self::install) does.
    ///
    /// The file is written in the clone, as the Waku version writes it, and not committed: the next pull fails once
    /// upstream changes `hangar.yml` too, as git refuses to overwrite the local change.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::NotInstalled`] before the store is cloned, [`StoreError::Config`] when `source` is
    /// invalid, which leaves the file untouched, and [`StoreError::Io`] when it cannot be written.
    pub async fn save_config(&self, source: &str) -> Result<Config, StoreError> {
        let file = self.data_dir.config_file();
        let config = Config::parse(source).map_err(|error| StoreError::Config {
            path: file.to_owned(),
            source: error,
        })?;

        if !self.is_installed().await {
            return Err(StoreError::NotInstalled);
        }

        if let Some(folder) = file.parent() {
            tokio::fs::create_dir_all(folder)
                .await
                .map_err(|error| StoreError::io("create", folder, error))?;
        }

        // Whole, by a rename: a read meanwhile, by the Waku version say, sees the old file or the new one.
        Disk::replace(file, source.as_bytes(), Access::Default)
            .await
            .map_err(|error| StoreError::io("write", file, error))?;
        self.link_all(&config).await;

        Ok(config)
    }

    /// Every app the store carries, installed or not, by id: each folder under `store/` named as an app id, but the
    /// shared files; what is not one, as `README.md`, `.github` or `Jellyfin`, is left out quietly. An app whose
    /// `compose.yml` cannot be read is logged and left out; none before the store is cloned.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Config`] when `hangar.yml` is invalid, and [`StoreError::Io`] when `store/` or
    /// `app-installed/` cannot be listed.
    pub async fn apps(&self) -> Result<Vec<StoreApp>, StoreError> {
        if !self.is_installed().await {
            return Ok(Vec::new());
        }

        let config = self.config().await?;
        // A clone without `app-installed/` yet, made by the Waku version say, has no app installed.
        let installed = match Self::names(self.data_dir.installed()).await {
            Ok(names) => names,
            Err(error) if Disk::is_missing(&error) => Vec::new(),
            Err(error) => return Err(StoreError::io("list", self.data_dir.installed(), error)),
        };
        let mut apps = Vec::new();

        // A clone without `store/`, an empty repository say, carries no app, as one without `hangar.yml` has no
        // category.
        let ids = match Self::names(self.data_dir.store_apps()).await {
            Ok(names) => names,
            Err(error) if Disk::is_missing(&error) => Vec::new(),
            Err(error) => return Err(StoreError::io("list", self.data_dir.store_apps(), error)),
        };

        for id in ids {
            let folder = self.data_dir.store_apps().join(&id);
            let is_app = AppId::regex().is_match(&id) && !config.shared.contains(&id);

            if !is_app || !Disk::is_folder(&folder).await {
                continue;
            }

            match StoreApp::read(&id, &folder, installed.contains(&id)).await {
                Ok(app) => apps.push(app),
                Err(error) => tracing::warn!(app = %id, %error, "skipping a store app"),
            }
        }

        apps.sort_by(|left, right| left.id.cmp(&right.id));

        Ok(apps)
    }

    /// The installed apps, by id.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`apps`](Self::apps).
    pub async fn installed_apps(&self) -> Result<Vec<StoreApp>, StoreError> {
        let mut apps = self.apps().await?;

        apps.retain(|app| app.installed);

        Ok(apps)
    }

    /// Installs the app `id`: links it into `app-installed/`, then adds to `.env.global` the variables its own files
    /// reference. An app linked already is left as it is; a dangling link in its place, as one to a store app removed
    /// upstream, is replaced.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::UnknownApp`] when the store carries no such app, [`StoreError::InTheWay`] when something
    /// else than a link to it sits in its place, [`StoreError::Io`] when it cannot be linked, and the errors of
    /// [`apps`](Self::apps) and of [`GlobalEnv::write`].
    pub async fn install_app(&self, id: &str) -> Result<(), StoreError> {
        self.app(id).await?;
        self.link(id).await?;
        // Only this app's files: the variables it needs show up without reading every app.
        self.env.ensure_app(id).await?;

        Ok(())
    }

    /// Whether the app `id` has its link in `app-installed/`, dangling or not: an app installed, whether the store
    /// still carries it, and its `compose.yml` parses, or not.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidAppId`] when `id` is not an app id, and [`StoreError::Io`] when its place cannot
    /// be inspected.
    pub async fn is_linked(&self, id: &str) -> Result<bool, StoreError> {
        if !AppId::regex().is_match(id) {
            return Err(StoreError::InvalidAppId { id: id.to_owned() });
        }

        let destination = self.data_dir.installed().join(id);

        match tokio::fs::symlink_metadata(&destination).await {
            Ok(metadata) => Ok(metadata.is_symlink()),
            Err(error) if Disk::is_missing(&error) => Ok(false),
            Err(error) => Err(StoreError::io("inspect", destination, error)),
        }
    }

    /// Uninstalls the app `id`: removes its link from `app-installed/`, leaving its folder in the store. Its stack is
    /// the caller's to take down first: once the link is gone, compose no longer reaches its files, and what runs is
    /// an orphan Hangar cannot manage.
    ///
    /// It goes by the link alone, so that an app the store no longer carries, or whose `compose.yml` no longer
    /// parses, still leaves; a dangling link too. An app not installed is left as it is.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidAppId`] when `id` is not an app id, [`StoreError::InTheWay`] when its place in
    /// `app-installed/` holds something else than a link, which is left as it is, and [`StoreError::Io`] when the
    /// link cannot be removed.
    pub async fn uninstall_app(&self, id: &str) -> Result<(), StoreError> {
        if !AppId::regex().is_match(id) {
            return Err(StoreError::InvalidAppId { id: id.to_owned() });
        }

        let destination = self.data_dir.installed().join(id);

        match tokio::fs::symlink_metadata(&destination).await {
            Err(error) if Disk::is_missing(&error) => Ok(()),
            Err(error) => Err(StoreError::io("inspect", destination, error)),
            Ok(metadata) if !metadata.is_symlink() => {
                Err(StoreError::InTheWay { path: destination })
            }
            Ok(_) => {
                tracing::info!(app = %id, "unlinking an app of the store");
                Disk::unlink(&destination)
                    .await
                    .map_err(|error| StoreError::io("unlink", destination, error))
            }
        }
    }

    /// The store's app `id`: one of its folders, so that an id never climbs out of `store/`.
    async fn app(&self, id: &str) -> Result<StoreApp, StoreError> {
        self.apps()
            .await?
            .into_iter()
            .find(|app| app.id == id)
            .ok_or_else(|| StoreError::UnknownApp { id: id.to_owned() })
    }

    /// Links every app the categories list, and the shared files beside them; one that cannot be linked is logged.
    async fn link_all(&self, config: &Config) {
        let shared = config.shared.iter().map(String::as_str);

        for entry in config.stacks().into_iter().chain(shared) {
            if let Err(error) = self.link(entry).await {
                tracing::error!(%entry, %error, "could not link an app of the store");
            }
        }
    }

    /// Links `name`, an app or a shared file, into `app-installed/`, when the store has it: in place of nothing, or of
    /// a dangling link; a link to it already is left as it is.
    async fn link(&self, name: &str) -> Result<(), StoreError> {
        // Checked here too, whatever the caller checked: joined to both folders, the name must stay in them.
        if !Disk::is_entry_name(name) {
            return Err(StoreError::InvalidName {
                name: name.to_owned(),
            });
        }

        let source = self.data_dir.store_apps().join(name);
        let destination = self.data_dir.installed().join(name);

        if !Disk::exists(&source).await {
            return Ok(());
        }

        match tokio::fs::symlink_metadata(&destination).await {
            Err(error) if Disk::is_missing(&error) => {}
            Err(error) => return Err(StoreError::io("inspect", destination, error)),
            Ok(metadata) if !metadata.is_symlink() => {
                return Err(StoreError::InTheWay { path: destination });
            }
            Ok(_) if Disk::is_same(&source, &destination).await => return Ok(()),
            Ok(_) if Disk::exists(&destination).await => {
                return Err(StoreError::InTheWay { path: destination });
            }
            Ok(_) => {
                tracing::info!(app = %name, "replacing a dangling link of the store");
                Disk::unlink(&destination)
                    .await
                    .map_err(|error| StoreError::io("unlink", &destination, error))?;
            }
        }

        let installed = self.data_dir.installed();

        tokio::fs::create_dir_all(installed)
            .await
            .map_err(|error| StoreError::io("create", installed, error))?;
        tracing::info!(app = %name, "linking an app of the store");
        Disk::link(&source, &destination)
            .await
            .map_err(|error| StoreError::io("link", destination, error))
    }

    /// `hangar.yml`, `None` when the store ships none.
    async fn read_config(&self) -> Result<Option<String>, StoreError> {
        let file = self.data_dir.config_file();

        match tokio::fs::read(file).await {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(StoreError::io("read", file, error)),
        }
    }

    /// Runs git with `args`, its output going to `output`; `action` names what failed.
    async fn git<'a>(
        &self,
        action: &'static str,
        args: impl IntoIterator<Item = &'a str>,
        output: Output,
    ) -> Result<(), StoreError> {
        let command = Command::new("git").args(args);

        self.runner
            .run(&command, output)
            .await
            .map_err(|source| StoreError::Git { action, source })
    }

    /// The names in `folder`, those that are UTF-8.
    async fn names(folder: &Path) -> io::Result<Vec<String>> {
        let mut reader = tokio::fs::read_dir(folder).await?;
        let mut names = Vec::new();

        while let Some(entry) = reader.next_entry().await? {
            names.extend(entry.file_name().into_string().ok());
        }

        Ok(names)
    }

    /// A path of the data directory as an argument: [`DataDir`] made sure it is UTF-8.
    fn arg(path: &Path) -> &str {
        path.to_str()
            .expect("the paths of the data directory are UTF-8")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{DataDir, Store, StoreError};
    use crate::{Output, Runtime};

    #[tokio::test]
    async fn links_nothing_that_would_leave_app_installed_whoever_calls() {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let data_dir = DataDir::new(dir.path()).expect("the temporary directory resolves");
        let store = Store::new("https://example.com/store.git", data_dir, Runtime::new());

        std::fs::create_dir_all(dir.path().join("app-data")).expect("app-data can be made");

        for name in [
            "../../app-data",
            "../app-data",
            "a/b",
            "/etc",
            "..",
            ".",
            "",
        ] {
            let error = store
                .link(name)
                .await
                .expect_err("the name leaves app-installed");

            assert!(
                matches!(error, StoreError::InvalidName { .. }),
                "{name:?}: {error:?}"
            );
        }

        assert!(
            !dir.path().join("app-installed").exists(),
            "nothing was linked"
        );
    }

    fn assert_send<T: Send>(_: T) {}

    #[test]
    fn returns_futures_that_are_send() {
        let data_dir = DataDir::new("/data").expect("an absolute path resolves");
        let store = Store::new("https://example.com/store.git", data_dir, Runtime::new());

        assert_send(store.install(Output::Inherit));
        assert_send(store.apps());
        assert_send(store.install_app("jellyfin"));
        assert_send(store.uninstall_app("jellyfin"));
        assert_send(store.is_linked("jellyfin"));
        assert_send(store.save_config("categories: []\n"));
        assert_send(store.env().ensure());
        assert_send(store.env().write(BTreeMap::new(), &[]));
        assert_send(store.files("jellyfin"));
        assert_send(store.create_app("jellyfin", "services: {}\n"));

        let files =
            super::AppFiles::new(&store, "jellyfin", "/data/app-store/store/jellyfin".into());

        assert_send(files.list());
        assert_send(files.read("compose.yml"));
        assert_send(files.create("compose.yml"));
        assert_send(files.write("compose.yml", "services: {}\n"));
    }
}
