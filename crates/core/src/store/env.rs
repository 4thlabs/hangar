//! `.env.global`, the environment every stack is composed with, and the `${VARIABLES}` the installed stacks reference.

mod dotenv;
mod format;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use regex::Regex;
use tokio::io::AsyncWriteExt;

use super::{DataDir, Disk, StoreError};
use dotenv::Dotenv;
use format::EnvFormat;

/// A reference to a variable in a compose file, `$FOO` or `${FOO…}`, capturing its name: what compose accepts as one.
static REFERENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)").expect("the pattern is valid"));

/// A whole string that is a variable name compose accepts.
static VARIABLE_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$").expect("the pattern is valid"));

/// The lock of each `.env.global` of the process, by its path: one per data directory, whatever the [`GlobalEnv`]s.
static LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(Mutex::default);

/// The global environment file, `.env.global`. Hand-edited as much as generated, so a write merges into what is on
/// disk, and drops only the variables it is told to.
///
/// Its format is the Waku version's: a header, the time of the last write, then the variables sorted, `KEY=value`,
/// quoted only where dotenv would otherwise read the value back another way. Each write first copies the file aside,
/// as `.env.global.<time>.bak`.
///
/// The writes of this process to one data directory take turns, from the read they merge into to the file in place;
/// and the file is replaced whole, by a rename, so that a compose run never reads it half written. Another process
/// writing the file at the same time, the Waku version say, is not covered: one of the two writes may be lost.
#[derive(Debug, Clone)]
pub struct GlobalEnv {
    file: PathBuf,
    installed: PathBuf,
    /// Values a new variable starts with, when Hangar knows the answer.
    defaults: BTreeMap<String, String>,
    /// Held from the read of a write to its rename.
    lock: Arc<tokio::sync::Mutex<()>>,
}

impl GlobalEnv {
    /// The variables compose fills in by itself: they are not the operator's to provide.
    const COMPOSE_VARIABLES: [&str; 2] = ["PWD", "COMPOSE_PROJECT_NAME"];

    /// The prefix of Hangar's shared paths, seeded whatever the apps.
    const SHARED_PREFIX: &str = "APP_";

    /// The extensions of the files compose interpolates: its own fragments and the `env_file:` targets beside them.
    const INTERPOLATED: [&str; 3] = [".yml", ".yaml", ".env"];

    /// The environment of `data_dir`, whose `APP_DATA_DIR` starts as its `app-data`: the stacks keep their data
    /// under the data directory Hangar itself uses. Reads nothing: neither the file nor the apps exist before the
    /// store is installed.
    pub fn new(data_dir: &DataDir) -> Self {
        let app_data = data_dir.app_data().to_string_lossy().into_owned();
        let file = data_dir.env_file().to_owned();
        let lock = LOCKS
            .lock()
            .expect("no thread panics while holding the locks")
            .entry(file.clone())
            .or_default()
            .clone();

        Self {
            file,
            installed: data_dir.installed().to_owned(),
            defaults: BTreeMap::from([("APP_DATA_DIR".to_owned(), app_data)]),
            lock,
        }
    }

    /// The file, `.env.global`.
    pub fn file(&self) -> &Path {
        &self.file
    }

    /// Whether `name` is a variable name compose accepts: letters, digits and `_`, not starting with a digit.
    pub fn is_variable_name(name: &str) -> bool {
        VARIABLE_NAME.is_match(name)
    }

    /// The variables on disk; a file that does not exist yet, on a fresh install, holds none.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Io`] when the file exists but cannot be read.
    pub async fn read(&self) -> Result<BTreeMap<String, String>, StoreError> {
        let bytes = match tokio::fs::read(&self.file).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(StoreError::io("read", &self.file, error)),
        };

        // Decoded as Node decodes it, a byte that is not UTF-8 replaced rather than failing the file.
        Ok(Dotenv::parse(&String::from_utf8_lossy(&bytes)))
    }

    /// Merges `updates` into what is on disk now, so that a variable added meanwhile survives, then drops the
    /// variables of `remove`, the only way one is ever lost. The file is copied aside first, then replaced whole.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidVariable`] for a name of `updates` that compose does not accept,
    /// [`StoreError::UnwritableValue`] for a value no quoting writes back the same, and [`StoreError::Io`] when the
    /// file cannot be read, copied aside or written. Nothing is written then; nor when the copy fails: the file holds
    /// secrets kept nowhere else.
    pub async fn write(
        &self,
        updates: BTreeMap<String, String>,
        remove: &[&str],
    ) -> Result<BTreeMap<String, String>, StoreError> {
        if let Some(key) = updates.keys().find(|key| !Self::is_variable_name(key)) {
            return Err(StoreError::InvalidVariable { key: key.clone() });
        }

        let _turn = self.lock.lock().await;

        self.update(updates, remove).await
    }

    /// [`write`](Self::write), its turn taken.
    async fn update(
        &self,
        updates: BTreeMap<String, String>,
        remove: &[&str],
    ) -> Result<BTreeMap<String, String>, StoreError> {
        let mut variables = self.read().await?;

        variables.extend(updates);

        for key in remove {
            variables.remove(*key);
        }

        let now = jiff::Timestamp::now();
        let contents = EnvFormat::serialize(&variables, &now)?;

        self.back_up(&now).await?;
        self.replace(contents.as_bytes()).await?;

        Ok(variables)
    }

    /// Every variable the installed apps reference, `${VAR}` and `$VAR`, seeded or not, sorted. A file that cannot be
    /// read is left out, and logged unless it is a dangling link.
    pub async fn required(&self) -> Vec<String> {
        let entries = self.entries().await;

        Self::referenced(&self.files(&entries).await).await
    }

    /// Adds to the file the namespaced variables the installed apps reference that it lacks, `APP_*` and `<APP>_*`,
    /// empty unless their value is known; and returns the variables. Only ever adds: a bare name like `DOMAIN` is
    /// left to the operator.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`read`](Self::read) and [`write`](Self::write).
    pub async fn ensure(&self) -> Result<BTreeMap<String, String>, StoreError> {
        let entries = self.entries().await;

        self.seed(&entries).await
    }

    /// [`ensure`](Self::ensure), reading the files of `app` alone: the variables it needs show up without reading
    /// every app. A variable of another app it references is seeded too, as glance reaching for `GLUETUN_API_KEY`.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`read`](Self::read) and [`write`](Self::write).
    pub async fn ensure_app(&self, app: &str) -> Result<BTreeMap<String, String>, StoreError> {
        self.seed(&[app.to_owned()]).await
    }

    /// Seeds the namespaced variables the files of `entries` reference.
    async fn seed(&self, entries: &[String]) -> Result<BTreeMap<String, String>, StoreError> {
        let _turn = self.lock.lock().await;
        let current = self.read().await?;
        // Naming the apps is a listing; reading their files is what a narrower scope saves.
        let prefixes: Vec<String> = std::iter::once(Self::SHARED_PREFIX.to_owned())
            .chain(self.apps().await.iter().flat_map(|app| Self::prefixes(app)))
            .collect();
        let missing: BTreeMap<String, String> = Self::referenced(&self.files(entries).await)
            .await
            .into_iter()
            .filter(|key| !current.contains_key(key))
            .filter(|key| {
                prefixes
                    .iter()
                    .any(|prefix| key.starts_with(prefix.as_str()))
            })
            .map(|key| {
                let value = self.defaults.get(&key).cloned().unwrap_or_default();

                (key, value)
            })
            .collect();

        if missing.is_empty() {
            return Ok(current);
        }

        self.update(missing, &[]).await
    }

    /// The installed apps: the entries of `app-installed` that read as a folder.
    async fn apps(&self) -> Vec<String> {
        let mut apps = Vec::new();

        for entry in self.entries().await {
            if Self::list(&self.installed.join(&entry)).await.is_some() {
                apps.push(entry);
            }
        }

        apps
    }

    /// The files compose reads for `entries`: the files of an app's own folder, not of `config/`, which the app reads
    /// itself; or the entry itself, a shared file such as `networks.yml`.
    async fn files(&self, entries: &[String]) -> Vec<PathBuf> {
        let mut files = Vec::new();

        for entry in entries {
            let target = self.installed.join(entry);

            match Self::list(&target).await {
                Some(names) => files.extend(names.into_iter().map(|name| target.join(name))),
                None => files.push(target),
            }
        }

        files
    }

    /// What sits in `app-installed`, the dotfiles aside; nothing when it does not exist yet.
    async fn entries(&self) -> Vec<String> {
        Self::list(&self.installed)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|entry| !entry.starts_with('.'))
            .collect()
    }

    /// The names in the folder `path`, `None` when it is not one: a shared file, a dangling link, or a folder that
    /// cannot be read, which is logged.
    async fn list(path: &Path) -> Option<Vec<String>> {
        let mut reader = match tokio::fs::read_dir(path).await {
            Ok(reader) => reader,
            Err(error) => {
                Self::log_unexpected(path, &error);
                return None;
            }
        };
        let mut names = Vec::new();

        loop {
            match reader.next_entry().await {
                Ok(Some(entry)) => names.extend(entry.file_name().into_string().ok()),
                Ok(None) => return Some(names),
                Err(error) => {
                    Self::log_unexpected(path, &error);
                    return Some(names);
                }
            }
        }
    }

    /// The variables `paths` reference, of those compose interpolates, sorted and each once, the ones compose fills
    /// aside.
    async fn referenced(paths: &[PathBuf]) -> Vec<String> {
        let mut keys = BTreeSet::new();

        for path in paths.iter().filter(|path| Self::is_interpolated(path)) {
            let bytes = match tokio::fs::read(path).await {
                Ok(bytes) => bytes,
                Err(error) => {
                    Self::log_unexpected(path, &error);
                    continue;
                }
            };

            // `$$` is compose's escape for a literal dollar: stripped first, or `$$FOO` would read as FOO.
            let source = String::from_utf8_lossy(&bytes).replace("$$", "");

            keys.extend(
                REFERENCE
                    .captures_iter(&source)
                    .map(|reference| reference[1].to_owned()),
            );
        }

        keys.into_iter()
            .filter(|key| !Self::COMPOSE_VARIABLES.contains(&key.as_str()))
            .collect()
    }

    /// Whether compose interpolates the file at `path`.
    fn is_interpolated(path: &Path) -> bool {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                Self::INTERPOLATED
                    .iter()
                    .any(|extension| name.ends_with(extension))
            })
    }

    /// Logs an error of the scan of the installed apps, unless it is one the scan expects: a dangling link, or a
    /// shared file read as a folder.
    fn log_unexpected(path: &Path, error: &io::Error) {
        let is_expected = matches!(
            error.kind(),
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
        );

        if !is_expected {
            tracing::warn!(path = %path.display(), %error, "skipping an unreadable path in the installed apps");
        }
    }

    /// The prefixes `app` owns: `sync-in` gives `SYNCIN_` and `SYNC_IN_`, as the store uses both. From the id alone,
    /// so `HASS_*` is not home-assistant's.
    fn prefixes(app: &str) -> [String; 2] {
        [app.replace('-', ""), app.replace('-', "_")]
            .map(|name| format!("{}_", name.to_uppercase()))
    }

    /// Copies the file aside, named after `now`, with a number after it when two writes share a millisecond, and its
    /// permissions. A file that does not exist yet has nothing to copy.
    async fn back_up(&self, now: &jiff::Timestamp) -> Result<(), StoreError> {
        let contents = match tokio::fs::read(&self.file).await {
            Ok(contents) => contents,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(StoreError::io("back up", &self.file, error)),
        };
        // `:` is fine on Linux but not everywhere, and these names are read by humans.
        let stamp = EnvFormat::timestamp(now).replace(':', "-");
        let name = |attempt: u32| match attempt {
            1 => self.beside(&format!(".{stamp}.bak")),
            _ => self.beside(&format!(".{stamp}-{attempt}.bak")),
        };

        self.create(name, &contents)
            .await
            .map(drop)
            .map_err(|error| StoreError::io("back up", &self.file, error))
    }

    /// Writes `contents` to a file beside `.env.global`, then renames it in its place, so that the file is never seen
    /// half written.
    async fn replace(&self, contents: &[u8]) -> Result<(), StoreError> {
        let process = std::process::id();
        let name = |attempt: u32| self.beside(&format!(".{process}-{attempt}.tmp"));
        let written = self
            .create(name, contents)
            .await
            .map_err(|error| StoreError::io("write", &self.file, error))?;

        if let Err(error) = tokio::fs::rename(&written, &self.file).await {
            Self::discard(&written).await;

            return Err(StoreError::io("write", &self.file, error));
        }

        Ok(())
    }

    /// Creates a new file named by `name`, with `contents` and the permissions of `.env.global` when it exists: it
    /// holds secrets, which an owner may have kept to themselves. A file left half written is removed.
    async fn create(&self, name: impl Fn(u32) -> PathBuf, contents: &[u8]) -> io::Result<PathBuf> {
        let (mut file, path) = Disk::create_new(name).await?;
        let written = async {
            if let Ok(metadata) = tokio::fs::metadata(&self.file).await {
                file.set_permissions(metadata.permissions()).await?;
            }

            file.write_all(contents).await?;
            file.sync_all().await
        };

        if let Err(error) = written.await {
            Self::discard(&path).await;

            return Err(error);
        }

        Ok(path)
    }

    /// Removes a file a failed write left: the write's error is the one returned, and this one is logged.
    async fn discard(path: &Path) {
        if let Err(error) = tokio::fs::remove_file(path).await {
            tracing::warn!(path = %path.display(), %error, "could not remove the file of a failed write");
        }
    }

    /// The path of `.env.global` followed by `suffix`.
    fn beside(&self, suffix: &str) -> PathBuf {
        let mut path = OsString::from(self.file.as_os_str());

        path.push(suffix);
        PathBuf::from(path)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::Path;

    use tempfile::TempDir;

    use super::GlobalEnv;
    use crate::store::{DataDir, StoreError};

    /// A data directory in a temporary directory, and its environment.
    struct Fixture {
        _dir: TempDir,
        data_dir: DataDir,
        env: GlobalEnv,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("a temporary directory can be made");
            let data_dir = DataDir::new(dir.path()).expect("the temporary directory resolves");
            let env = GlobalEnv::new(&data_dir);

            std::fs::create_dir(data_dir.installed()).expect("app-installed can be made");

            Self {
                _dir: dir,
                data_dir,
                env,
            }
        }

        /// Installs an app with its compose file, and an `app.env` beside it when given.
        fn stack(&self, app: &str, compose: &str, app_env: Option<&str>) {
            let folder = self.data_dir.installed().join(app);

            std::fs::create_dir_all(&folder).expect("the app's folder can be made");
            std::fs::write(folder.join("compose.yml"), compose)
                .expect("compose.yml can be written");

            if let Some(app_env) = app_env {
                std::fs::write(folder.join("app.env"), app_env).expect("app.env can be written");
            }
        }

        fn app_data(&self) -> String {
            self.data_dir.app_data().to_string_lossy().into_owned()
        }
    }

    fn variables<const N: usize>(pairs: [(&str, &str); N]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    fn backups(dir: &Path) -> Vec<String> {
        let mut backups: Vec<String> = std::fs::read_dir(dir)
            .expect("the data directory is readable")
            .map(|entry| {
                entry
                    .expect("an entry is readable")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.ends_with(".bak"))
            .collect();

        backups.sort();
        backups
    }

    #[tokio::test]
    async fn reads_a_file_that_does_not_exist_yet_as_an_empty_environment() {
        let fixture = Fixture::new();

        assert!(
            fixture
                .env
                .read()
                .await
                .expect("a missing file reads")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn collects_the_variables_the_installed_apps_reference_and_only_those() {
        let fixture = Fixture::new();

        fixture.stack(
            "alpha-app",
            "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG:-latest}\n    working_dir: ${PWD}\n    environment:\n      DOMAIN: $DOMAIN\n      PRICE: $$5\n      ESCAPED: $$ESCAPED\n",
            None,
        );
        std::fs::write(
            fixture.data_dir.installed().join("networks.yml"),
            "networks:\n  web:\n    name: ${NETWORK}\n",
        )
        .expect("a shared file can be written");

        // PWD is compose's to fill, `$$5` and `$$ESCAPED` are escaped dollars, the rest is the operator's.
        assert_eq!(
            fixture.env.required().await,
            ["ALPHA_APP_TAG", "DOMAIN", "NETWORK"]
        );
    }

    #[tokio::test]
    async fn reads_the_env_files_beside_a_compose_file_and_not_the_app_s_own_configuration() {
        let fixture = Fixture::new();

        fixture.stack(
            "alpha-app",
            "services:\n  alpha:\n    image: alpha\n    env_file: [./app.env]\n",
            Some("UPLOAD=${APP_PHOTO_DIR}/alpha\nTOKEN=${ALPHA_APP_TOKEN}\n"),
        );

        let widgets = fixture
            .data_dir
            .installed()
            .join("alpha-app")
            .join("config")
            .join("widgets");

        std::fs::create_dir_all(&widgets).expect("the app's configuration can be made");
        std::fs::write(widgets.join("card.yml"), "url: ${ALPHA_APP_WIDGET_URL}\n")
            .expect("the app's configuration can be written");

        assert_eq!(
            fixture.env.required().await,
            ["ALPHA_APP_TOKEN", "APP_PHOTO_DIR"]
        );
    }

    #[tokio::test]
    async fn asks_for_nothing_when_no_app_is_installed_yet() {
        let fixture = Fixture::new();

        std::fs::remove_dir(fixture.data_dir.installed()).expect("app-installed can be removed");

        assert!(fixture.env.required().await.is_empty());
    }

    #[tokio::test]
    async fn seeds_the_namespaced_variables_and_leaves_the_bare_ones_to_the_operator() {
        let fixture = Fixture::new();

        fixture.stack(
            "alpha-app",
            "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG}\n    volumes: [${APP_DATA_DIR}/alpha:/data]\n    environment:\n      TZ: ${TZ}\n      DOMAIN: ${DOMAIN}\n      PHOTOS: ${APP_PHOTO_DIR}\n",
            None,
        );

        let seeded = fixture
            .env
            .ensure()
            .await
            .expect("the environment can be seeded");
        let expected = variables([
            ("ALPHA_APP_TAG", ""),
            ("APP_DATA_DIR", &fixture.app_data()),
            ("APP_PHOTO_DIR", ""),
        ]);

        // TZ and DOMAIN belong to no app: they are the operator's to add, not Hangar's to guess.
        assert_eq!(seeded, expected);
        assert_eq!(fixture.env.read().await.expect("the file reads"), expected);
    }

    #[tokio::test]
    async fn takes_the_prefix_from_the_app_id_with_the_hyphens_dropped_as_well_as_kept() {
        let fixture = Fixture::new();

        fixture.stack(
            "sync-in",
            "services:\n  sync-in:\n    environment:\n      SECRET: ${SYNCIN_AUTH_SECRET}\n      PORT: ${SYNC_IN_PORT}\n",
            None,
        );

        let seeded = fixture
            .env
            .ensure()
            .await
            .expect("the environment can be seeded");

        assert_eq!(
            seeded,
            variables([("SYNCIN_AUTH_SECRET", ""), ("SYNC_IN_PORT", "")])
        );
    }

    #[tokio::test]
    async fn reads_only_the_named_app_s_files_and_still_seeds_the_neighbours_it_references() {
        let fixture = Fixture::new();

        // What glance does: its own env file reaches for a key gluetun owns.
        fixture.stack(
            "alpha-app",
            "services:\n  alpha:\n    image: alpha\n",
            Some("GLUETUN=${GLUETUN_API_KEY}\n"),
        );
        fixture.stack(
            "gluetun",
            "services:\n  gluetun:\n    image: gluetun:${GLUETUN_TAG}\n",
            None,
        );

        let seeded = fixture
            .env
            .ensure_app("alpha-app")
            .await
            .expect("the environment can be seeded");

        // GLUETUN_API_KEY comes from alpha-app's own file; GLUETUN_TAG lives in a file never opened.
        assert_eq!(seeded, variables([("GLUETUN_API_KEY", "")]));
    }

    #[tokio::test]
    async fn ignores_an_app_that_sits_in_the_store_but_was_never_installed() {
        let fixture = Fixture::new();
        let beta = fixture.data_dir.store_apps().join("beta-app");

        fixture.stack(
            "alpha-app",
            "services:\n  alpha:\n    image: alpha:${ALPHA_APP_TAG}\n",
            None,
        );
        std::fs::create_dir_all(&beta).expect("the store's app can be made");
        std::fs::write(
            beta.join("compose.yml"),
            "services:\n  beta:\n    image: beta:${BETA_APP_TAG}\n",
        )
        .expect("the store's app can be written");

        let seeded = fixture
            .env
            .ensure()
            .await
            .expect("the environment can be seeded");

        assert_eq!(seeded, variables([("ALPHA_APP_TAG", "")]));
    }

    #[tokio::test]
    async fn never_overwrites_a_value_nor_removes_a_variable_filled_in_by_hand() {
        let fixture = Fixture::new();

        fixture.stack(
            "alpha-app",
            "services:\n  alpha:\n    environment:\n      TAG: ${ALPHA_APP_TAG}\n      KEY: ${ALPHA_APP_KEY}\n      DOMAIN: ${DOMAIN}\n",
            None,
        );
        fixture
            .env
            .write(
                variables([("ALPHA_APP_TAG", "v1"), ("DOMAIN", "example.com")]),
                &[],
            )
            .await
            .expect("the file can be written");

        let seeded = fixture
            .env
            .ensure()
            .await
            .expect("the environment can be seeded");

        assert_eq!(
            seeded,
            variables([
                ("ALPHA_APP_KEY", ""),
                ("ALPHA_APP_TAG", "v1"),
                ("DOMAIN", "example.com")
            ])
        );
    }

    #[tokio::test]
    async fn keeps_a_variable_added_by_hand_and_drops_only_those_it_is_told_to() {
        let fixture = Fixture::new();
        let file = fixture.env.file().to_owned();

        fixture
            .env
            .write(
                variables([("DOMAIN", "example.com"), ("TZ", "Europe/Paris")]),
                &[],
            )
            .await
            .expect("the file can be written");
        // What a hand edit, or another tab, does between a render and its save.
        std::fs::write(
            &file,
            "DOMAIN=example.com\nTZ=Europe/Paris\nHAND_WRITTEN=secret\n",
        )
        .expect("the file can be edited");

        let written = fixture
            .env
            .write(variables([("DOMAIN", "other.com")]), &["TZ"])
            .await
            .expect("the file can be written");

        assert_eq!(
            written,
            variables([("DOMAIN", "other.com"), ("HAND_WRITTEN", "secret")])
        );
        assert_eq!(fixture.env.read().await.expect("the file reads"), written);
    }

    #[tokio::test]
    async fn copies_the_file_aside_before_each_rewrite() {
        let fixture = Fixture::new();

        fixture
            .env
            .write(variables([("DOMAIN", "example.com")]), &[])
            .await
            .expect("the file can be written");

        // The first write had nothing to copy.
        assert!(backups(fixture.data_dir.root()).is_empty());

        fixture
            .env
            .write(variables([("DOMAIN", "other.com")]), &[])
            .await
            .expect("the file can be written");

        let backups = backups(fixture.data_dir.root());
        let [backup] = backups.as_slice() else {
            panic!("one backup, got {backups:?}");
        };
        let copy = std::fs::read_to_string(fixture.data_dir.root().join(backup))
            .expect("the backup reads");

        // `.env.global.2026-11-25T10-20-30.123Z.bak`: the time of the write, to the millisecond, without `:`.
        assert!(backup.starts_with(".env.global.20"), "{backup}");
        assert_eq!(
            backup.len(),
            ".env.global.2026-11-25T10-20-30.123Z.bak".len(),
            "{backup}"
        );
        assert!(!backup.contains(':'), "{backup}");
        assert_eq!(
            super::Dotenv::parse(&copy),
            variables([("DOMAIN", "example.com")])
        );
    }

    #[tokio::test]
    async fn writes_a_sorted_file_with_the_waku_version_s_header() {
        let fixture = Fixture::new();

        fixture
            .env
            .write(
                variables([("TZ", "Europe/Paris"), ("ACME_EMAIL", "root@example.com")]),
                &[],
            )
            .await
            .expect("the file can be written");

        let contents = std::fs::read_to_string(fixture.env.file()).expect("the file reads");
        let lines: Vec<&str> = contents.lines().collect();

        assert_eq!(lines[0], "# Global Environment Variables");
        assert_eq!(lines[1], "# These variables are available to all projects");
        assert!(
            lines[2].starts_with("# Last updated: 20") && lines[2].ends_with('Z'),
            "{}",
            lines[2]
        );
        assert_eq!(
            lines[3..],
            ["", "ACME_EMAIL=root@example.com", "TZ=Europe/Paris"]
        );
        assert!(contents.ends_with("TZ=Europe/Paris\n"));
    }

    #[tokio::test]
    async fn reads_back_a_value_written_by_hand_after_any_number_of_writes() {
        let fixture = Fixture::new();

        std::fs::write(fixture.env.file(), "DB_PASSWORD=\"p#ss w0rd \"\n")
            .expect("the file can be edited");

        for round in 0..2 {
            fixture
                .env
                .write(variables([("ROUND", &round.to_string())]), &[])
                .await
                .expect("the file can be written");
        }

        let read = fixture.env.read().await.expect("the file reads");

        assert_eq!(
            read.get("DB_PASSWORD").map(String::as_str),
            Some("p#ss w0rd ")
        );
    }

    #[tokio::test]
    async fn writes_a_value_with_a_newline_without_adding_a_variable() {
        let fixture = Fixture::new();

        fixture
            .env
            .write(variables([("KEY", "a\nINJECTED=1")]), &[])
            .await
            .expect("the file can be written");

        assert_eq!(
            fixture.env.read().await.expect("the file reads"),
            variables([("KEY", "a\nINJECTED=1")])
        );
    }

    #[tokio::test]
    async fn refuses_a_name_compose_does_not_accept_and_writes_nothing() {
        let fixture = Fixture::new();

        for key in ["", "1A", "A-B", "A B", "A\nB", "A=B"] {
            let error = fixture
                .env
                .write(variables([("GOOD", "1"), (key, "x")]), &[])
                .await
                .expect_err("the name is refused");

            assert!(
                matches!(error, StoreError::InvalidVariable { .. }),
                "{key:?}: {error:?}"
            );
        }

        assert!(!fixture.env.file().exists());
    }

    #[tokio::test]
    async fn loses_no_write_when_many_run_at_once() {
        let fixture = Fixture::new();
        let writes = (0..20).map(|index| {
            let env = GlobalEnv::new(&fixture.data_dir);

            async move {
                env.write(variables([(&format!("KEY_{index}"), "set")]), &[])
                    .await
            }
        });

        for written in futures::future::join_all(writes).await {
            written.expect("the file can be written");
        }

        let leftovers: Vec<_> = std::fs::read_dir(fixture.data_dir.root())
            .expect("the data directory is readable")
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| name.ends_with(".tmp"))
            .collect();

        assert_eq!(fixture.env.read().await.expect("the file reads").len(), 20);
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[tokio::test]
    async fn numbers_the_copies_of_writes_that_share_a_millisecond() {
        let fixture = Fixture::new();
        let now = jiff::Timestamp::now();

        std::fs::write(fixture.env.file(), "DOMAIN=example.com\n")
            .expect("the file can be written");
        fixture
            .env
            .back_up(&now)
            .await
            .expect("the file can be copied");
        fixture
            .env
            .back_up(&now)
            .await
            .expect("the file can be copied again");

        let backups = backups(fixture.data_dir.root());

        assert_eq!(backups.len(), 2, "{backups:?}");
        assert!(
            backups.iter().any(|backup| backup.ends_with("Z-2.bak")),
            "{backups:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keeps_the_permissions_of_the_file_and_gives_them_to_its_copies() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new();
        let mode = |path: &Path| {
            std::fs::metadata(path)
                .expect("the file is there")
                .permissions()
                .mode()
                & 0o777
        };

        std::fs::write(fixture.env.file(), "SECRET=1\n").expect("the file can be written");
        std::fs::set_permissions(fixture.env.file(), std::fs::Permissions::from_mode(0o600))
            .expect("the permissions can be set");
        fixture
            .env
            .write(variables([("SECRET", "2")]), &[])
            .await
            .expect("the file can be written");

        let backup = fixture
            .data_dir
            .root()
            .join(&backups(fixture.data_dir.root())[0]);

        assert_eq!(mode(fixture.env.file()), 0o600);
        assert_eq!(mode(&backup), 0o600);
    }

    #[test]
    fn tells_a_variable_name_compose_accepts() {
        for name in ["DOMAIN", "_PRIVATE", "APP_DATA_DIR", "a1"] {
            assert!(GlobalEnv::is_variable_name(name), "{name}");
        }

        for name in ["", "1A", "A-B", "A B", "A\nB"] {
            assert!(!GlobalEnv::is_variable_name(name), "{name:?}");
        }
    }
}
