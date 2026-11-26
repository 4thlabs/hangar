//! The files of a store app, as the editor lists, reads, creates and writes them, each by its path in the app's
//! folder, as `config/settings.yml`. Every path is checked to stay in the folder before anything is read or written.

mod editable;
mod location;
mod syntax;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::{Access, Disk, Store, StoreApp, StoreError};
use crate::{CommandRunner, Compose, ComposeError, Secrets};
use editable::EditableFile;
use location::Location;
use syntax::FileSyntax;

/// The files of one app of a [`Store`], from [`Store::files`].
///
/// ```no_run
/// # async fn example() -> Result<(), hangar_core::StoreError> {
/// use hangar_core::{DataDir, Runtime, Store};
///
/// let store = Store::new("https://example.com/store.git", DataDir::from_env()?, Runtime::new());
/// let files = store.files("jellyfin").await?;
///
/// for path in files.list().await {
///     println!("{path}");
/// }
///
/// // Written once `docker compose config` accepts it, and `docker stack config` too beside a compose.swarm.yml.
/// let compose = files.read("compose.yml").await?;
/// let saved = files.write("compose.yml", &compose.replace("latest", "10.10")).await?;
///
/// assert!(saved.compose_changed);
/// # Ok(())
/// # }
/// ```
#[derive(Debug)]
pub struct AppFiles<'a, R> {
    store: &'a Store<R>,
    id: String,
    folder: PathBuf,
}

/// What a write of an app's file did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct SavedFile {
    /// Whether it wrote one of the app's compose files, whatever path led to it: that may rename the app, change its
    /// icon, or let it run in the swarm.
    pub compose_changed: bool,
}

/// The compose files of an app, which Docker checks before they are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ComposeFile {
    /// `compose.yml`, checked by `docker compose config`, and by `docker stack config` beside a `compose.swarm.yml`
    /// with content.
    Compose,
    /// `compose.swarm.yml`, checked by `docker stack config` merged over `compose.yml`.
    Swarm,
}

impl<'a, R: CommandRunner> AppFiles<'a, R> {
    /// The files of the app `id` of `store`, in `folder`.
    pub(super) fn new(store: &'a Store<R>, id: &str, folder: PathBuf) -> Self {
        Self {
            store,
            id: id.to_owned(),
            folder,
        }
    }

    /// The app's id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The text files of the app, as paths in its folder with `/` between their segments, sorted. Hidden files, as
    /// the pending copies of a save, binaries, symlinks and files over 1 MiB are left out: none is the operator's to
    /// edit. The listing goes 5 folders deep and stops at 500 files, and leaves out what it cannot read, which it
    /// logs: an app may bind-mount its data into its folder.
    pub async fn list(&self) -> Vec<String> {
        EditableFile::list(&self.folder).await
    }

    /// The text of the app's file at `path`.
    ///
    /// # Errors
    ///
    /// Returns the errors of the path's check ([`StoreError::InvalidPath`], [`StoreError::ThroughFile`],
    /// [`StoreError::BrokenSymlink`], [`StoreError::OutsideApp`]), [`StoreError::NoSuchFile`] when the file is not
    /// there, [`StoreError::NotAFile`], [`StoreError::TooLarge`], [`StoreError::Binary`] and
    /// [`StoreError::NotUtf8Text`] for a file the editor does not open, and [`StoreError::Io`] when it cannot be read.
    pub async fn read(&self, path: &str) -> Result<String, StoreError> {
        let location = self.locate(path).await?;

        EditableFile::read(&location.file, &self.id, path).await
    }

    /// Creates the app's file at `path`, empty, and its missing folders.
    ///
    /// # Errors
    ///
    /// Returns the errors of the path's check, as [`read`](Self::read) does, [`StoreError::FileExists`] when anything
    /// is there, a file the listing hides included, and [`StoreError::Io`] when it cannot be created.
    pub async fn create(&self, path: &str) -> Result<(), StoreError> {
        let location = self.locate(path).await?;

        EditableFile::create(&location.file, path).await
    }

    /// Writes `source` to the app's file at `path`, creating it and its missing folders, once it is checked:
    /// `docker compose config` for the app's `compose.yml`, and `docker stack config` too when its
    /// `compose.swarm.yml` has content; `docker stack config` for its `compose.swarm.yml`, merged over the other;
    /// whatever path leads to them, a symlink or another case. A YAML or a `.env` file is parsed, any other written as
    /// it is.
    ///
    /// A compose file is written beside, then renamed in its place once checked: it stays as it is until then, and
    /// Docker reads it anew each time. Any other file is rewritten in place, its inode kept, as a container that
    /// bind-mounts it sees that inode alone. A file refused is left as it is.
    ///
    /// # Errors
    ///
    /// Returns the errors of the path's check, as [`read`](Self::read) does; [`StoreError::InvalidFile`] for a YAML or
    /// `.env` file that does not parse; [`StoreError::Rejected`], with Docker's complaint, for a compose file Docker
    /// refuses, and [`StoreError::Unchecked`] for one it could not check; [`StoreError::NotAFile`] and
    /// [`StoreError::FileAppeared`] when something else took the file's place; [`StoreError::Interrupted`], naming the
    /// copy that keeps the new text, when the file was left half written; and [`StoreError::Io`] when it cannot be
    /// written, or `.env.global` read for `docker stack config`.
    pub async fn write(&self, path: &str, source: &str) -> Result<SavedFile, StoreError> {
        let location = self.locate(path).await?;
        let size = source.len() as u64;

        // What the editor could not open again, `compose.yml` and the whole page with it.
        if size > EditableFile::MAX_SIZE {
            return Err(StoreError::TooLarge {
                path: path.to_owned(),
                size,
            });
        }

        for (name, kind) in [
            (StoreApp::COMPOSE_FILE, ComposeFile::Compose),
            (StoreApp::SWARM_FILE, ComposeFile::Swarm),
        ] {
            if location.is_root_file(name).await? {
                self.write_checked(&location, path, source, kind).await?;

                return Ok(SavedFile {
                    compose_changed: true,
                });
            }
        }

        FileSyntax::check(path, &location.file, source)?;
        EditableFile::write(&location.file, path, source).await?;

        Ok(SavedFile {
            compose_changed: false,
        })
    }

    /// Where the file at `path` really is.
    async fn locate(&self, path: &str) -> Result<Location, StoreError> {
        Location::find(&self.id, &self.folder, path).await
    }

    /// Writes `source`, the compose file `kind` at `path`, to a pending copy beside it, has Docker check the copy,
    /// then moves it in its place. Refused, only the copy is removed.
    async fn write_checked(
        &self,
        location: &Location,
        path: &str,
        source: &str,
        kind: ComposeFile,
    ) -> Result<(), StoreError> {
        let target = &location.file;
        // Beside the file, so that the paths it names resolve the same; hidden, so that the listing leaves it out;
        // under a name no other save holds, so that two saves at once never remove each other's.
        let process = std::process::id();
        let name = |attempt: u32| {
            location
                .folder
                .join(format!(".compose.{process}-{attempt}.pending.yml"))
        };
        let pending = Disk::write_new(name, source.as_bytes(), target, Access::Default)
            .await
            .map_err(|error| StoreError::io("write", target, error))?;
        let moved = match self
            .check(&location.folder, &pending, path, kind, source)
            .await
        {
            Ok(()) => tokio::fs::rename(&pending, target)
                .await
                .map_err(|error| StoreError::io("rename", target, error)),
            Err(error) => Err(error),
        };

        if moved.is_err() {
            Disk::discard(&pending).await;
        }

        moved
    }

    /// Has Docker check `pending`, the new copy of the compose file `kind` at `path` of the app in `folder`, which
    /// holds `source`. A blank `compose.swarm.yml` is not checked: `docker stack config` refuses an empty file, and a
    /// blank one is how an app is taken off the swarm, as Hangar reads it as not ready for it.
    async fn check(
        &self,
        folder: &Path,
        pending: &Path,
        path: &str,
        kind: ComposeFile,
        source: &str,
    ) -> Result<(), StoreError> {
        if kind == ComposeFile::Swarm && source.trim().is_empty() {
            return Ok(());
        }

        let compose = Compose::new(self.store.data_dir.clone(), &self.store.runner);
        // Read whatever the check, for the values its complaint must not carry: `docker compose` reads them from
        // `--env-file`, `docker stack` from its environment.
        let variables = self.store.env.read().await?;
        let refusal = |error| Self::refusal(error, folder, pending, path, &variables);

        match kind {
            ComposeFile::Compose => {
                compose.validate(pending).await.map_err(refusal)?;

                // An edit here can break the stack: a top-level `name`, a `depends_on` with a condition.
                let swarm = folder.join(StoreApp::SWARM_FILE);

                if Disk::has_content(&swarm).await {
                    compose
                        .validate_stack(pending, &swarm, &variables)
                        .await
                        .map_err(refusal)?;
                }
            }
            ComposeFile::Swarm => {
                let compose_file = folder.join(StoreApp::COMPOSE_FILE);

                compose
                    .validate_stack(&compose_file, pending, &variables)
                    .await
                    .map_err(refusal)?;
            }
        }

        Ok(())
    }

    /// The error of a check of `pending`, the file at `path` in `folder`, that did not pass: Docker's complaint, with
    /// the pending copy named as the file it stands for, the files of the folder by their paths in it, and the values
    /// of `variables` and of this process's environment taken out, as an interpolation error echoes the value at fault.
    fn refusal(
        error: ComposeError,
        folder: &Path,
        pending: &Path,
        path: &str,
        variables: &BTreeMap<String, String>,
    ) -> StoreError {
        let ComposeError::Invalid { source, .. } = &error else {
            return StoreError::Unchecked {
                path: path.to_owned(),
                source: Box::new(error),
            };
        };
        let crate::RunError::Failed { stderr, .. } = source else {
            return StoreError::Unchecked {
                path: path.to_owned(),
                source: Box::new(error),
            };
        };
        let mut complaint = stderr.replace(&*pending.to_string_lossy(), path);

        complaint = complaint.replace(&format!("{}/", folder.to_string_lossy()), "");

        complaint = Secrets::with_environment(variables).mask(&complaint);

        StoreError::Rejected {
            path: path.to_owned(),
            complaint,
            source: Box::new(error),
        }
    }
}

impl<R: CommandRunner> Store<R> {
    /// The files of the app `id`: its folder under `store/`, whether its `compose.yml` parses or not, so that the
    /// editor can fix it.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidAppId`] when `id` is not an app id, [`StoreError::SharedFile`] when it names a
    /// shared file, [`StoreError::UnknownApp`] when the store has no such folder, and [`StoreError::Config`] when
    /// `hangar.yml` is invalid.
    pub async fn files(&self, id: &str) -> Result<AppFiles<'_, R>, StoreError> {
        let folder = self.editable_folder(id).await?;

        if !Disk::is_folder(&folder).await {
            return Err(StoreError::UnknownApp { id: id.to_owned() });
        }

        Ok(AppFiles::new(self, id, folder))
    }

    /// Creates the app `id`, its folder under `store/` and its `compose.yml`, `source`, once `docker compose config`
    /// accepts it. A source refused creates nothing: the folder is removed.
    ///
    /// The app is created in the clone, as [`save_config`](Self::save_config) writes `hangar.yml`, and not committed.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidAppId`] and [`StoreError::SharedFile`] as [`files`](Self::files) does,
    /// [`StoreError::NotInstalled`] before the store is cloned, [`StoreError::AppExists`] when anything sits in its
    /// place, and the errors of [`AppFiles::write`].
    pub async fn create_app(&self, id: &str, source: &str) -> Result<(), StoreError> {
        let folder = self.editable_folder(id).await?;

        if !self.is_installed().await {
            return Err(StoreError::NotInstalled);
        }

        let apps = self.data_dir.store_apps();

        tokio::fs::create_dir_all(apps)
            .await
            .map_err(|error| StoreError::io("create", apps, error))?;

        // Created alone, so that a folder made meanwhile, or a link in its place, is refused rather than taken.
        match tokio::fs::create_dir(&folder).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(StoreError::AppExists { id: id.to_owned() });
            }
            Err(error) => return Err(StoreError::io("create", folder, error)),
        }

        let written = AppFiles::new(self, id, folder.clone())
            .write(StoreApp::COMPOSE_FILE, source)
            .await;

        if written.is_err()
            && let Err(error) = tokio::fs::remove_dir_all(&folder).await
        {
            tracing::warn!(app = %id, %error, "could not remove the folder of an app refused");
        }

        written.map(drop)
    }

    /// The folder of the app `id`, which the editor may change: an app id, not one of the shared files.
    async fn editable_folder(&self, id: &str) -> Result<PathBuf, StoreError> {
        if !super::AppId::regex().is_match(id) {
            return Err(StoreError::InvalidAppId { id: id.to_owned() });
        }

        if self
            .config()
            .await?
            .shared
            .iter()
            .any(|shared| shared == id)
        {
            return Err(StoreError::SharedFile { id: id.to_owned() });
        }

        Ok(self.data_dir.store_apps().join(id))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::{MetadataExt, symlink};
    use std::path::{Path, PathBuf};

    use tempfile::TempDir;

    use super::{SavedFile, Store, StoreError};
    use crate::runtime::fake::{FakeRunner, Reply};
    use crate::{ComposeError, DataDir};

    /// A data directory whose store is cloned, with the app `web`, its compose file and a few of its own, the app
    /// `beta`, a secret beside them, and the shared file `networks.yml`.
    struct Fixture {
        _dir: TempDir,
        root: PathBuf,
        store: Store<FakeRunner>,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("a temporary directory can be made");
            let root = dir.path().join("data");
            let apps = root.join("app-store/store");

            fs::create_dir_all(root.join("app-store/.git")).expect("created");
            fs::create_dir_all(root.join("app-store/config")).expect("created");
            fs::create_dir_all(apps.join("web/config")).expect("created");
            fs::create_dir_all(apps.join("beta")).expect("created");
            fs::write(
                root.join("app-store/config/hangar.yml"),
                "categories: []\nshared: [networks.yml]\n",
            )
            .expect("written");
            fs::write(apps.join("networks.yml"), "networks: {}\n").expect("written");
            fs::write(apps.join("web/compose.yml"), "services:\n  web: {}\n").expect("written");
            fs::write(apps.join("web/config/settings.yml"), "a: 1\n").expect("written");
            fs::write(apps.join("beta/compose.yml"), "services: {}\n").expect("written");
            fs::write(root.join("secret.txt"), "the secret\n").expect("written");

            let data_dir = DataDir::new(&root).expect("the data directory resolves");

            Self {
                store: Store::new("https://example.com/store.git", data_dir, FakeRunner::new()),
                _dir: dir,
                root,
            }
        }

        /// The folder of the app `web`.
        fn web(&self) -> PathBuf {
            self.root.join("app-store/store/web")
        }

        fn read(&self, path: &Path) -> String {
            fs::read_to_string(path).expect("the file reads")
        }

        /// The names in the folder of `web`, hidden ones included.
        fn entries(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(self.web())
                .expect("the folder reads")
                .map(|entry| {
                    entry
                        .expect("an entry")
                        .file_name()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();

            names.sort();
            names
        }
    }

    #[tokio::test]
    async fn lists_the_text_files_sorted_and_leaves_out_what_the_editor_does_not_open() {
        let fixture = Fixture::new();
        let web = fixture.web();
        let deep = web.join("a/b/c/d/e/f");

        fs::write(web.join(".env"), "SECRET=1\n").expect("written");
        fs::create_dir_all(web.join(".git")).expect("created");
        fs::write(web.join(".git/config"), "x\n").expect("written");
        fs::write(web.join("logo.png"), b"\x89PNG\0\0").expect("written");
        fs::write(web.join("big.log"), vec![b'a'; 1024 * 1024 + 1]).expect("written");
        fs::write(web.join("app.env"), "A=1\n").expect("written");
        symlink(fixture.root.join("secret.txt"), web.join("link.txt")).expect("linked");
        symlink(fixture.root.join("app-store"), web.join("linked")).expect("linked");
        fs::create_dir_all(&deep).expect("created");
        fs::write(deep.parent().expect("a parent").join("five.yml"), "a: 1\n").expect("written");
        fs::write(deep.join("six.yml"), "a: 1\n").expect("written");

        let files = fixture.store.files("web").await.expect("web is an app");

        assert_eq!(
            files.list().await,
            [
                "a/b/c/d/e/five.yml",
                "app.env",
                "compose.yml",
                "config/settings.yml"
            ]
        );
    }

    #[tokio::test]
    async fn stops_the_listing_at_its_count() {
        let fixture = Fixture::new();

        for index in 0..600 {
            fs::write(fixture.web().join(format!("file-{index:03}.txt")), "x").expect("written");
        }

        let files = fixture.store.files("web").await.expect("web is an app");

        let listed = files.list().await;

        assert_eq!(listed.len(), 500);
        assert_eq!(listed[0], "compose.yml");
        assert_eq!(listed[499], "file-498.txt", "the first ones by name");
    }

    #[tokio::test]
    async fn counts_only_the_files_it_lists_so_that_images_hide_none_of_the_app_s_own() {
        let fixture = Fixture::new();

        for index in 0..800 {
            fs::write(
                fixture.web().join(format!("image-{index:03}.png")),
                b"\x89PNG\0",
            )
            .expect("written");
        }

        let files = fixture.store.files("web").await.expect("web is an app");

        assert_eq!(files.list().await, ["compose.yml", "config/settings.yml"]);
    }

    #[tokio::test]
    async fn reads_a_text_file_byte_order_mark_kept_and_refuses_what_it_does_not_open() {
        let fixture = Fixture::new();
        let web = fixture.web();

        fs::write(web.join("bom.txt"), "\u{feff}hello\n").expect("written");
        fs::write(web.join("logo.png"), b"\x89PNG\0\0").expect("written");
        fs::write(web.join("latin1.txt"), b"caf\xe9\n").expect("written");
        fs::write(web.join("big.log"), vec![b'a'; 1024 * 1024 + 1]).expect("written");

        let files = fixture.store.files("web").await.expect("web is an app");

        assert_eq!(
            files.read("bom.txt").await.expect("text"),
            "\u{feff}hello\n"
        );
        assert_eq!(
            files.read("config/settings.yml").await.expect("text"),
            "a: 1\n"
        );

        let refusals = [
            ("missing.yml", "the app web has no file missing.yml"),
            ("config", "config is not a file"),
            ("logo.png", "logo.png is not a text file"),
            (
                "latin1.txt",
                "latin1.txt is not UTF-8 text: saving it from the editor would corrupt it",
            ),
            (
                "big.log",
                "big.log is too large to edit here: 1048577 bytes, 1 MiB at most",
            ),
        ];

        for (path, message) in refusals {
            let error = files.read(path).await.expect_err("refused");

            assert_eq!(error.to_string(), message, "{path}");
        }
    }

    #[tokio::test]
    async fn refuses_every_path_that_escapes_the_app_s_folder_whatever_the_call() {
        let fixture = Fixture::new();
        let web = fixture.web();

        symlink(fixture.root.join("secret.txt"), web.join("secret.txt")).expect("linked");
        symlink(fixture.root.join("app-store/store/beta"), web.join("beta")).expect("linked");
        symlink(fixture.root.join("nowhere"), web.join("dangling.yml")).expect("linked");
        symlink(fixture.root.join("nowhere"), web.join("dangling")).expect("linked");

        let files = fixture.store.files("web").await.expect("web is an app");
        let escapes = [
            ("", "invalid file path: \"\""),
            ("..", "invalid file path: \"..\""),
            (
                "../beta/compose.yml",
                "invalid file path: \"../beta/compose.yml\"",
            ),
            (
                "config/../../beta/compose.yml",
                "invalid file path: \"config/../../beta/compose.yml\"",
            ),
            ("./compose.yml", "invalid file path: \"./compose.yml\""),
            ("/etc/passwd", "invalid file path: \"/etc/passwd\""),
            (".env", "invalid file path: \".env\""),
            ("config/.secret", "invalid file path: \"config/.secret\""),
            (
                "config//settings.yml",
                "invalid file path: \"config//settings.yml\"",
            ),
            ("config/", "invalid file path: \"config/\""),
            ("compose.yml\0", "invalid file path: \"compose.yml\\0\""),
            ("secret.txt", "secret.txt leads outside the app web"),
            (
                "beta/compose.yml",
                "beta/compose.yml leads outside the app web",
            ),
            ("beta/new.yml", "beta/new.yml leads outside the app web"),
            ("dangling.yml", "dangling.yml is a broken symlink"),
            ("dangling/new.yml", "dangling is a broken symlink"),
            (
                "compose.yml/x",
                "compose.yml/x goes through a file, not a folder",
            ),
        ];

        for (path, message) in escapes {
            let read = files.read(path).await.expect_err("refused");
            let create = files.create(path).await.expect_err("refused");
            let write = files.write(path, "a: 2\n").await.expect_err("refused");

            for error in [read, create, write] {
                assert_eq!(error.to_string(), message, "{path:?}");
            }
        }

        assert_eq!(
            fixture.read(&fixture.root.join("secret.txt")),
            "the secret\n"
        );
        assert_eq!(
            fixture.read(&fixture.root.join("app-store/store/beta/compose.yml")),
            "services: {}\n"
        );
        assert!(
            !fixture.root.join("nowhere").exists(),
            "nothing was created through a link"
        );
        assert!(!fixture.root.join("app-store/store/beta/new.yml").exists());
        assert!(fixture.store.runner.runs().is_empty(), "docker never ran");
    }

    #[tokio::test]
    async fn refuses_a_visible_link_to_a_hidden_entry_of_the_app() {
        let fixture = Fixture::new();
        let web = fixture.web();

        fs::write(web.join(".env"), "SECRET=1\n").expect("written");
        fs::create_dir_all(web.join(".git")).expect("created");
        symlink(web.join(".env"), web.join("env.txt")).expect("linked");
        symlink(web.join(".git"), web.join("repository")).expect("linked");

        let files = fixture.store.files("web").await.expect("web is an app");

        for path in ["env.txt", "repository/config"] {
            let read = files.read(path).await.expect_err("refused");
            let create = files.create(path).await.expect_err("refused");
            let write = files.write(path, "A=2\n").await.expect_err("refused");

            for error in [read, create, write] {
                assert_eq!(error.to_string(), format!("{path} leads to a hidden file"));
            }
        }

        assert_eq!(fixture.read(&web.join(".env")), "SECRET=1\n");
        assert!(!web.join(".git/config").exists());
    }

    #[tokio::test]
    async fn checks_a_file_reached_through_a_link_by_its_own_extension() {
        let fixture = Fixture::new();
        let settings = fixture.web().join("config/settings.yml");

        symlink(&settings, fixture.web().join("settings.txt")).expect("linked");

        let files = fixture.store.files("web").await.expect("web is an app");
        let error = files
            .write("settings.txt", "a: [1\n")
            .await
            .expect_err("not YAML");

        assert!(
            matches!(error, StoreError::InvalidFile { ref path, .. } if path == "settings.txt")
        );
        assert_eq!(fixture.read(&settings), "a: 1\n");
    }

    #[tokio::test]
    async fn saves_beside_a_dangling_link_in_place_of_a_compose_file() {
        let fixture = Fixture::new();

        symlink(
            fixture.root.join("nowhere"),
            fixture.web().join("compose.swarm.yml"),
        )
        .expect("linked");

        let files = fixture.store.files("web").await.expect("web is an app");

        files
            .write("config/settings.yml", "a: 2\n")
            .await
            .expect("written");
        files
            .write("compose.yml", "services:\n  web: {}\n")
            .await
            .expect("accepted");

        assert_eq!(fixture.store.runner.runs().len(), 1, "compose alone");
        assert!(!fixture.root.join("nowhere").exists());
    }

    #[tokio::test]
    async fn follows_a_symlink_that_stays_in_the_app_s_folder() {
        let fixture = Fixture::new();

        symlink(
            fixture.web().join("config/settings.yml"),
            fixture.web().join("settings.yml"),
        )
        .expect("linked");

        let files = fixture.store.files("web").await.expect("web is an app");

        files
            .write("settings.yml", "a: 2\n")
            .await
            .expect("written");

        assert_eq!(
            fixture.read(&fixture.web().join("config/settings.yml")),
            "a: 2\n"
        );
        assert!(
            fixture.web().join("settings.yml").is_symlink(),
            "the link stays"
        );
    }

    #[tokio::test]
    async fn refuses_the_files_of_what_is_not_an_app() {
        let fixture = Fixture::new();

        for (id, message) in [
            ("networks.yml", "networks.yml is a shared file, not an app"),
            ("missing", "the store has no app missing"),
            ("../app-store", "\"../app-store\" is not an app id"),
            (".git", "\".git\" is not an app id"),
        ] {
            let error = fixture.store.files(id).await.expect_err("not an app");

            assert_eq!(error.to_string(), message, "{id}");
        }
    }

    #[tokio::test]
    async fn rewrites_a_file_in_place_keeping_its_inode_and_creates_one_with_its_folders() {
        let fixture = Fixture::new();
        let settings = fixture.web().join("config/settings.yml");
        let inode = fs::metadata(&settings).expect("there").ino();
        let files = fixture.store.files("web").await.expect("web is an app");

        let saved = files
            .write("config/settings.yml", "a: 2\n")
            .await
            .expect("written");
        let created = files
            .write("new/folder/notes.md", "# Notes\n")
            .await
            .expect("written");

        assert_eq!(
            saved,
            SavedFile {
                compose_changed: false
            }
        );
        assert_eq!(
            created,
            SavedFile {
                compose_changed: false
            }
        );
        assert_eq!(fixture.read(&settings), "a: 2\n");
        assert_eq!(
            fs::metadata(&settings).expect("there").ino(),
            inode,
            "the same inode"
        );
        assert_eq!(
            fs::read_dir(fixture.web().join("config"))
                .expect("reads")
                .count(),
            1,
            "no copy left beside"
        );
        assert_eq!(
            fixture.read(&fixture.web().join("new/folder/notes.md")),
            "# Notes\n"
        );
        assert!(fixture.store.runner.runs().is_empty(), "docker never ran");
    }

    #[tokio::test]
    async fn refuses_a_yaml_or_env_file_that_does_not_parse_and_leaves_it_as_it_was() {
        let fixture = Fixture::new();
        let files = fixture.store.files("web").await.expect("web is an app");

        fs::write(fixture.web().join("app.env"), "A=1\n").expect("written");

        let yaml = files
            .write("config/settings.yml", "a: [1\n")
            .await
            .expect_err("refused");
        let env = files
            .write("app.env", "A=1\nB 2\n")
            .await
            .expect_err("refused");

        assert!(
            matches!(yaml, StoreError::InvalidFile { ref path, .. } if path == "config/settings.yml")
        );
        assert_eq!(
            env.to_string(),
            "app.env is not valid: line 2: expected VARIABLE=value, got \"B 2\""
        );
        assert_eq!(
            fixture.read(&fixture.web().join("config/settings.yml")),
            "a: 1\n"
        );
        assert_eq!(fixture.read(&fixture.web().join("app.env")), "A=1\n");
    }

    #[tokio::test]
    async fn creates_an_empty_file_and_refuses_one_where_anything_is() {
        let fixture = Fixture::new();
        let files = fixture.store.files("web").await.expect("web is an app");

        files.create("config/extra/new.yml").await.expect("created");

        assert_eq!(
            fixture.read(&fixture.web().join("config/extra/new.yml")),
            ""
        );

        for path in ["compose.yml", "config"] {
            let error = files.create(path).await.expect_err("taken");

            assert_eq!(error.to_string(), format!("{path} already exists"));
        }

        assert_eq!(
            fixture.read(&fixture.web().join("compose.yml")),
            "services:\n  web: {}\n"
        );
    }

    #[tokio::test]
    async fn writes_compose_yml_through_a_copy_compose_checks_whatever_path_leads_to_it() {
        let fixture = Fixture::new();
        let compose = fixture.web().join("compose.yml");

        symlink(&compose, fixture.web().join("alias.yml")).expect("linked");

        let files = fixture.store.files("web").await.expect("web is an app");

        for (index, path) in ["compose.yml", "alias.yml", "Compose.yml"]
            .into_iter()
            .enumerate()
        {
            let source = format!("services:\n  web{index}: {{}}\n");
            let saved = files.write(path, &source).await.expect("accepted");

            assert_eq!(
                saved,
                SavedFile {
                    compose_changed: true
                },
                "{path}"
            );

            let runs = fixture.store.runner.runs();
            let check = &runs[index];
            let pending = &check.args[4];

            assert_eq!(
                check.args[..4],
                [
                    "compose",
                    "--env-file",
                    fixture.store.env.file().to_str().expect("UTF-8"),
                    "-f"
                ]
            );
            assert_eq!(check.args[5..], ["config", "-q"]);
            assert!(
                pending.starts_with(fixture.web().to_str().expect("UTF-8")),
                "{pending}"
            );
            assert!(pending.contains("/.compose."), "{pending}");
        }

        assert_eq!(fixture.read(&compose), "services:\n  web1: {}\n");
        assert_eq!(
            fixture.read(&fixture.web().join("Compose.yml")),
            "services:\n  web2: {}\n",
            "a file of its own on a file system that keeps case"
        );
        assert!(
            fixture.web().join("alias.yml").is_symlink(),
            "the link stays"
        );
        assert_eq!(
            fixture.entries(),
            ["Compose.yml", "alias.yml", "compose.yml", "config"]
        );
    }

    #[tokio::test]
    async fn leaves_compose_yml_as_it_was_when_compose_refuses_it_and_says_why_in_its_own_names() {
        let fixture = Fixture::new();
        let files = fixture.store.files("web").await.expect("web is an app");
        let real = fs::canonicalize(fixture.web()).expect("resolves");
        let real = real.to_str().expect("UTF-8");

        fixture.store.runner.reply(Reply::Failure {
            code: 15,
            stderr: format!(
                "validating {real}/.compose.{}-1.pending.yml: services.web additional property foo\nsee {real}/config/settings.yml\n",
                std::process::id()
            ),
        });

        let error = files
            .write("compose.yml", "services:\n  web:\n    foo: 1\n")
            .await
            .expect_err("refused");

        let StoreError::Rejected {
            complaint, source, ..
        } = &error
        else {
            panic!("{error:?}");
        };

        assert_eq!(
            complaint,
            "validating compose.yml: services.web additional property foo\nsee config/settings.yml"
        );
        assert!(matches!(**source, ComposeError::Invalid { .. }));
        assert_eq!(error.to_string(), "docker rejects compose.yml");
        assert_eq!(
            fixture.read(&fixture.web().join("compose.yml")),
            "services:\n  web: {}\n"
        );
        assert_eq!(fixture.entries(), ["compose.yml", "config"], "no copy left");
    }

    #[tokio::test]
    async fn says_a_compose_file_docker_could_not_check_is_unchecked() {
        let fixture = Fixture::new();
        let data_dir = fixture.store.data_dir.clone();
        let unstartable = Store::new("https://example.com/store.git", data_dir, Unstartable);
        let files = unstartable.files("web").await.expect("web is an app");

        let error = files
            .write("compose.yml", "services: {}\n")
            .await
            .expect_err("docker does not start");

        assert!(
            matches!(error, StoreError::Unchecked { ref path, .. } if path == "compose.yml"),
            "{error:?}"
        );
        assert_eq!(fixture.entries(), ["compose.yml", "config"], "no copy left");
    }

    #[tokio::test]
    async fn checks_the_stack_too_beside_a_compose_swarm_yml_with_content_and_the_swarm_file_against_compose_yml()
     {
        let fixture = Fixture::new();
        let swarm = fixture.web().join("compose.swarm.yml");

        fs::write(fixture.root.join(".env.global"), "WEB_TAG=1.2\n").expect("written");
        fs::write(&swarm, "  \n").expect("written");

        let files = fixture.store.files("web").await.expect("web is an app");

        files
            .write("compose.yml", "services:\n  web: {}\n")
            .await
            .expect("accepted");

        assert_eq!(
            fixture.store.runner.runs().len(),
            1,
            "a blank compose.swarm.yml is not checked"
        );

        files
            .write("compose.swarm.yml", "services:\n  web:\n    deploy: {}\n")
            .await
            .expect("accepted");
        files
            .write("compose.yml", "services:\n  web: {}\n")
            .await
            .expect("accepted");

        let runs = fixture.store.runner.runs();
        let real = fs::canonicalize(fixture.web()).expect("resolves");

        assert_eq!(runs.len(), 4);
        assert_eq!(runs[1].args[..3], ["stack", "config", "-c"]);
        assert_eq!(
            runs[1].args[3],
            real.join("compose.yml").to_str().expect("UTF-8")
        );
        assert!(
            runs[1].args[5].contains("/.compose."),
            "the copy of compose.swarm.yml"
        );
        assert_eq!(runs[1].env["WEB_TAG"], "1.2");
        assert_eq!(runs[2].args[0], "compose", "compose.yml by compose first");
        assert_eq!(runs[3].args[..3], ["stack", "config", "-c"]);
        assert!(
            runs[3].args[3].contains("/.compose."),
            "the copy of compose.yml"
        );
        assert_eq!(
            runs[3].args[5],
            real.join("compose.swarm.yml").to_str().expect("UTF-8")
        );
        assert_eq!(fixture.read(&swarm), "services:\n  web:\n    deploy: {}\n");

        let saved = files
            .write("compose.swarm.yml", "\n")
            .await
            .expect("taken off the swarm");

        assert_eq!(
            saved,
            SavedFile {
                compose_changed: true
            }
        );
        assert_eq!(
            fixture.store.runner.runs().len(),
            4,
            "a blank compose.swarm.yml is not checked"
        );
        assert_eq!(fixture.read(&swarm), "\n");
    }

    #[tokio::test]
    async fn creates_an_app_once_compose_accepts_it_and_nothing_when_it_refuses() {
        let fixture = Fixture::new();
        let apps = fixture.root.join("app-store/store");

        fixture
            .store
            .create_app("new-app", "services:\n  new-app: {}\n")
            .await
            .expect("created");

        assert_eq!(
            fixture.read(&apps.join("new-app/compose.yml")),
            "services:\n  new-app: {}\n"
        );

        fixture.store.runner.reply(Reply::Failure {
            code: 15,
            stderr: "services must be a mapping\n".to_owned(),
        });

        let error = fixture
            .store
            .create_app("refused", "services: 1\n")
            .await
            .expect_err("refused");

        assert!(
            matches!(error, StoreError::Rejected { ref complaint, .. } if complaint == "services must be a mapping")
        );
        assert!(!apps.join("refused").exists(), "its folder is removed");

        for (id, message) in [
            ("web", "the app web already exists"),
            ("networks.yml", "networks.yml is a shared file, not an app"),
            ("New App", "\"New App\" is not an app id"),
            ("../escape", "\"../escape\" is not an app id"),
        ] {
            let error = fixture
                .store
                .create_app(id, "services: {}\n")
                .await
                .expect_err("refused");

            assert_eq!(error.to_string(), message, "{id}");
        }

        symlink(fixture.root.join("nowhere"), apps.join("linked")).expect("linked");

        let error = fixture
            .store
            .create_app("linked", "services: {}\n")
            .await
            .expect_err("taken");

        assert!(matches!(error, StoreError::AppExists { .. }));
        assert!(!fixture.root.join("nowhere").exists());
    }

    #[tokio::test]
    async fn creates_no_app_before_the_store_is_cloned() {
        let fixture = Fixture::new();

        fs::remove_dir_all(fixture.root.join("app-store/.git")).expect("removed");

        let error = fixture
            .store
            .create_app("new-app", "services: {}\n")
            .await
            .expect_err("not cloned");

        assert!(matches!(error, StoreError::NotInstalled));
        assert!(!fixture.root.join("app-store/store/new-app").exists());
    }

    #[tokio::test]
    async fn refuses_a_file_over_the_size_the_editor_opens_before_anything_runs() {
        let fixture = Fixture::new();
        let files = fixture.store.files("web").await.expect("web is an app");
        let large = "a".repeat(1024 * 1024 + 1);

        for path in ["config/settings.yml", "compose.yml"] {
            let error = files.write(path, &large).await.expect_err("too large");

            assert!(
                matches!(
                    error,
                    StoreError::TooLarge {
                        size: 1_048_577,
                        ..
                    }
                ),
                "{error:?}"
            );
        }

        files
            .write("config/settings.yml", &"a".repeat(1024 * 1024))
            .await
            .expect("1 MiB is the limit");

        assert!(fixture.store.runner.runs().is_empty(), "docker never ran");
        assert_eq!(
            fixture.read(&fixture.web().join("compose.yml")),
            "services:\n  web: {}\n"
        );
    }

    #[tokio::test]
    async fn takes_the_values_of_the_environment_out_of_docker_s_complaint() {
        let fixture = Fixture::new();
        let path = std::env::var("PATH").expect("the tests have a PATH");

        fs::write(
            fixture.root.join(".env.global"),
            "WEB_TOKEN=hunter2-secret\nWEB_REPLICAS=2\n",
        )
        .expect("written");
        fixture.store.runner.reply(Reply::Failure {
            code: 15,
            stderr: format!(
                "line 2: invalid interpolation format for services.web.image: \"hunter2-secret\", replicas 2\nsee {path}\n"
            ),
        });

        let files = fixture.store.files("web").await.expect("web is an app");
        let error = files
            .write("compose.yml", "services:\n  web:\n    image: ${WEB_TOKEN\n")
            .await
            .expect_err("refused");
        let StoreError::Rejected { complaint, .. } = &error else {
            panic!("{error:?}");
        };

        assert_eq!(
            complaint,
            "line 2: invalid interpolation format for services.web.image: \"***\", replicas 2\nsee ***",
            "a value too short to be a secret stays"
        );
    }

    /// A runner whose commands never start.
    struct Unstartable;

    impl crate::CommandRunner for Unstartable {
        async fn run(
            &self,
            command: &crate::Command,
            _: crate::Output,
        ) -> Result<(), crate::RunError> {
            Err(Self::spawn(command))
        }

        async fn capture(&self, command: &crate::Command) -> Result<String, crate::RunError> {
            Err(Self::spawn(command))
        }
    }

    impl Unstartable {
        fn spawn(command: &crate::Command) -> crate::RunError {
            crate::RunError::Spawn {
                program: command.program.clone(),
                source: std::io::Error::from(std::io::ErrorKind::NotFound),
            }
        }
    }
}
