//! The backups: a zip of each app's data folder, as its `backups:` entry in `hangar.yml` says, kept in
//! `app-backups/<app>/`, listed, read and removed.
//!
//! The archives are the Waku version's, so that both read the same folder. One is named after the time its backup
//! started at, `app-backups/<app>/2026-10-18T03-30-00-000Z.zip`, and written as `.zip.partial` first, renamed once
//! complete. Its entries keep the path of the backed-up folder under `app-data/` (`jellyfin/config/…`), so that
//! unzipping it into `app-data/` restores it in place.
//!
//! Unix only: a backup opens each folder and each file through the descriptor of the folder it is in, never through a
//! link, while the app may be running and changing them.
//!
//! ```no_run
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! use hangar_core::{AppBackups, CancellationToken, DataDir, Runtime, Store};
//!
//! let data_dir = DataDir::from_env()?;
//! let store = Store::new("https://example.com/store.git", data_dir.clone(), Runtime::new());
//! let backups = AppBackups::new(data_dir, Runtime::new());
//! let config = store.config().await?;
//!
//! if let Some(backup) = config.backup("jellyfin") {
//!     let summary = backups.back_up(backup, &CancellationToken::new()).await?;
//!
//!     println!("{} files in {}", summary.files, summary.archive);
//! }
//!
//! for archive in backups.list("jellyfin").await? {
//!     println!("{} {} bytes", archive.created_at, archive.size);
//! }
//! # Ok(())
//! # }
//! ```

mod archive;
mod error;
mod files;
mod names;
mod services;

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

pub use error::BackupError;

use crate::store::AppId;
use crate::{Backup, CommandRunner, Compose, DataDir};
use archive::Archive;
use files::BackupFiles;
use names::ArchiveName;
use services::Services;

/// What one backup wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct BackupSummary {
    /// The archive's name, the time the backup started at, as `2026-10-18T03-30-00-000Z`.
    pub archive: String,
    /// Its size, in bytes.
    pub size: u64,
    /// How many files it holds.
    pub files: u64,
    /// The symbolic links left out of it: a backup follows none.
    pub skipped_links: u64,
    /// The FIFOs, sockets and devices the globs matched, left out of it: they have nothing to read.
    pub skipped_special: u64,
    /// The services stopped while their files were read, then started again; none without `stop`.
    pub stopped: Vec<String>,
}

/// An archive of an app, as its page lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct BackupArchive {
    /// Its name, the time its backup started at, as `2026-10-18T03-30-00-000Z`.
    pub name: String,
    /// Its size, in bytes.
    pub size: u64,
    /// When its backup started, in RFC 3339, as `2026-10-18T03:30:00.000Z`.
    pub created_at: String,
}

/// An archive on disk, to send.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ArchiveFile {
    /// Its path.
    pub path: PathBuf,
    /// Its size, in bytes.
    pub size: u64,
    /// The file name to save it under, `<app>-<archive>.zip`.
    pub download_name: String,
}

/// The backups of a data directory's apps: each archives the app's data folder, stopping its running services first
/// when it says so, and starting them again whatever the outcome, but never the container Hangar runs in. Its compose
/// commands run through a [`CommandRunner`]; its work on the disk runs on Tokio's blocking threads.
///
/// The backups of one app take turns, whoever asks for them: a second waits for the first to end, as they would
/// remove each other's partial archive and stop and start the same services. Its clones share the turns.
#[derive(Debug, Clone)]
pub struct AppBackups<R> {
    data_dir: DataDir,
    compose: Compose<R>,
    services: Services,
    /// The turn of each app's backups, by app.
    turns: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl<R: CommandRunner> AppBackups<R> {
    /// The backups of `data_dir`'s apps, their compose commands run by `runner`. The container Hangar runs in is told
    /// by this process's hostname, which Docker gives a container as its short id.
    pub fn new(data_dir: DataDir, runner: R) -> Self {
        Self::with_hostname(data_dir, runner, Services::hostname())
    }

    /// The backups of [`new`](Self::new), the container Hangar runs in told by `hostname`.
    fn with_hostname(data_dir: DataDir, runner: R, hostname: Option<String>) -> Self {
        Self {
            compose: Compose::new(data_dir.clone(), runner),
            data_dir,
            services: Services::new(hostname),
            turns: Arc::default(),
        }
    }

    /// Archives the data folder of `backup`'s app, then removes its archives beyond `keep`, the oldest first. With
    /// `stop`, the services that run or restart are stopped while their files are read, and started again whatever
    /// the outcome, by the project's name: in the order of their dependencies, and whatever their compose file says by
    /// then.
    /// Once `cancel` is cancelled, it stops at its next file or read, removes what it wrote of the archive, and
    /// starts again what it stopped.
    ///
    /// A file gone since the walk listed it is passed over, and an archive that the pruning could not remove is
    /// logged: neither fails the backup.
    ///
    /// It waits for the end of a backup of the same app that runs, or for `cancel`. The future must be awaited to its
    /// end, and stopped through `cancel` alone: dropped once the services are stopped, it never starts them again.
    ///
    /// # Errors
    ///
    /// - [`BackupError::NoDataFolder`] for a folder to back up that is not there, [`BackupError::LinkedFolder`] for one
    ///   with a link in its path, [`BackupError::OutsideAppData`] for a path that could lead out of `app-data/`, and
    ///   [`BackupError::InvalidGlob`] for a glob that is not read, before anything is stopped;
    /// - [`BackupError::RunsHangar`] when a service to stop runs in the container Hangar runs in, and
    ///   [`BackupError::NotStopped`] or [`BackupError::UnreadableServices`] when the services could not be stopped:
    ///   nothing is archived then, and those listed are started again;
    /// - [`BackupError::Canceled`] once canceled, [`BackupError::Io`] when the archive cannot be written, and
    ///   [`BackupError::Crashed`] when its writing panicked;
    /// - [`BackupError::NotRestarted`] when the services stopped do not start again, with the failure of the backup
    ///   when it failed too.
    pub async fn back_up(
        &self,
        backup: &Backup,
        cancel: &CancellationToken,
    ) -> Result<BackupSummary, BackupError> {
        let app = backup.app.clone();
        let folder = self.folder(&app)?;
        let turn = self.turn(&app);
        let _turn = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(BackupError::Canceled { app }),
            held = turn.lock() => held,
        };
        let prefix = backup.path.clone().unwrap_or_else(|| app.clone());
        let app_data = self.data_dir.app_data().to_owned();
        let root_path = app_data.join(&prefix);
        let root = Self::blocking(&app, {
            let (app, prefix) = (app.clone(), prefix.clone());

            move || BackupFiles::open_root(&app_data, &app, &prefix)
        })
        .await?;
        let files = BackupFiles::new(root, root_path, &backup.include, &backup.exclude)?;

        if cancel.is_cancelled() {
            return Err(BackupError::Canceled { app });
        }

        let stopped = if backup.stop {
            self.services.stop(&self.compose, &app).await?
        } else {
            Vec::new()
        };
        let archived = Self::blocking(&app, {
            let cancel = cancel.clone();

            move || Self::write(&folder, &prefix, files, &cancel)
        })
        .await
        .map_err(|error| match error {
            _ if cancel.is_cancelled() => BackupError::Canceled { app: app.clone() },
            error => error,
        });

        if !stopped.is_empty()
            && let Err(source) = Services::start(&self.compose, &app, &stopped).await
        {
            return Err(BackupError::NotRestarted {
                app,
                services: stopped,
                source: Box::new(source),
                failure: archived.err().map(Box::new),
            });
        }

        let mut summary = archived?;

        summary.stopped = stopped;
        tracing::info!(
            %app,
            archive = %summary.archive,
            files = summary.files,
            "an app is backed up"
        );
        self.prune(&app, backup.keep).await;

        Ok(summary)
    }

    /// The archives of `app`, the newest first; none when it was never backed up.
    ///
    /// # Errors
    ///
    /// [`BackupError::InvalidApp`] for a name that is not an app id, and [`BackupError::Io`] when its folder cannot be
    /// read.
    pub async fn list(&self, app: &str) -> Result<Vec<BackupArchive>, BackupError> {
        let folder = self.folder(app)?;

        Self::blocking(app, move || Self::archives(&folder)).await
    }

    /// The archive `archive` of `app`, to send.
    ///
    /// # Errors
    ///
    /// [`BackupError::InvalidApp`] and [`BackupError::InvalidArchive`] for names that could address no archive,
    /// [`BackupError::UnknownArchive`] when there is no such archive, and [`BackupError::Io`] when it cannot be read.
    pub async fn file(&self, app: &str, archive: &str) -> Result<ArchiveFile, BackupError> {
        let path = self.archive_path(app, archive)?;
        let (owned_app, owned_archive) = (app.to_owned(), archive.to_owned());

        Self::blocking(app, move || {
            let metadata = fs::metadata(&path)
                .map_err(|error| Self::unless_unknown(error, &path, &owned_app, &owned_archive))?;

            if !metadata.is_file() {
                return Err(BackupError::UnknownArchive {
                    app: owned_app,
                    archive: owned_archive,
                });
            }

            Ok(ArchiveFile {
                download_name: format!("{owned_app}-{owned_archive}{}", ArchiveName::EXTENSION),
                size: metadata.len(),
                path,
            })
        })
        .await
    }

    /// Removes the archive `archive` of `app`.
    ///
    /// # Errors
    ///
    /// The errors of [`file`](Self::file).
    pub async fn remove(&self, app: &str, archive: &str) -> Result<(), BackupError> {
        let path = self.archive_path(app, archive)?;
        let (owned_app, owned_archive) = (app.to_owned(), archive.to_owned());

        Self::blocking(app, move || {
            fs::remove_file(&path)
                .map_err(|error| Self::unless_unknown(error, &path, &owned_app, &owned_archive))
        })
        .await?;

        tracing::info!(app, archive, "an archive is removed");

        Ok(())
    }

    /// Removes the archives of `app` beyond the `keep` newest; a failure is logged, as the new archive is written by
    /// now.
    async fn prune(&self, app: &str, keep: u64) {
        let Ok(folder) = self.folder(app) else {
            return;
        };
        let keep = usize::try_from(keep).unwrap_or(usize::MAX);
        let pruned = Self::blocking(app, move || {
            for archive in Self::archives(&folder)?.into_iter().skip(keep) {
                let path = folder.join(format!("{}{}", archive.name, ArchiveName::EXTENSION));

                BackupFiles::unless_gone(fs::remove_file(&path))
                    .map_err(|error| BackupError::io("remove", &path, error))?;
            }

            Ok(())
        })
        .await;

        if let Err(error) = pruned {
            tracing::warn!(app, keep, error = %Self::chain(&error), "could not remove the oldest archives");
        }
    }

    /// The folder of `app`'s archives, once its name is known not to climb out of `app-backups/`.
    fn folder(&self, app: &str) -> Result<PathBuf, BackupError> {
        if !AppId::regex().is_match(app) {
            return Err(BackupError::InvalidApp {
                app: app.to_owned(),
            });
        }

        Ok(self.data_dir.backups().join(app))
    }

    /// The file of the archive `archive` of `app`, once its name is known to be an archive's.
    fn archive_path(&self, app: &str, archive: &str) -> Result<PathBuf, BackupError> {
        if !ArchiveName::is_valid(archive) {
            return Err(BackupError::InvalidArchive {
                archive: archive.to_owned(),
            });
        }

        Ok(self
            .folder(app)?
            .join(format!("{archive}{}", ArchiveName::EXTENSION)))
    }

    /// The turn of `app`'s backups.
    fn turn(&self, app: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut turns = self.turns.lock().unwrap_or_else(PoisonError::into_inner);

        Arc::clone(turns.entry(app.to_owned()).or_default())
    }

    /// Runs `work` on a blocking thread; its panic is the backup of `app` crashed.
    async fn blocking<T: Send + 'static>(
        app: &str,
        work: impl FnOnce() -> Result<T, BackupError> + Send + 'static,
    ) -> Result<T, BackupError> {
        tokio::task::spawn_blocking(work).await.unwrap_or_else(|_| {
            tracing::error!(app, "the work of a backup on the disk panicked");

            Err(BackupError::Crashed {
                app: app.to_owned(),
            })
        })
    }

    /// Writes `files` into a new archive of `folder`, its entries under `prefix`, once the partial archives a killed
    /// backup left are removed: a partial archive first, renamed once complete, and removed when it fails.
    fn write(
        folder: &Path,
        prefix: &str,
        mut files: BackupFiles,
        cancel: &CancellationToken,
    ) -> Result<BackupSummary, BackupError> {
        fs::create_dir_all(folder).map_err(|error| BackupError::io("create", folder, error))?;
        Self::remove_partials(folder)?;

        let name = loop {
            let name = ArchiveName::of(jiff::Timestamp::now());

            if fs::symlink_metadata(folder.join(format!("{name}{}", ArchiveName::EXTENSION)))
                .is_err()
            {
                break name;
            }

            // A backup ended within this millisecond: this one takes the next, rather than replace its archive.
            std::thread::sleep(Duration::from_millis(1));
        };
        let partial = folder.join(format!("{name}{}", ArchiveName::PARTIAL_EXTENSION));
        let target = folder.join(format!("{name}{}", ArchiveName::EXTENSION));
        let written = Archive::new(prefix, cancel)
            .write(&mut files, &partial)
            .and_then(|count| {
                fs::rename(&partial, &target)
                    .map_err(|error| BackupError::io("rename", &partial, error))?;

                Ok(count)
            });
        let count = match written {
            Ok(count) => count,
            Err(error) => {
                if let Err(removal) = BackupFiles::unless_gone(fs::remove_file(&partial)) {
                    tracing::warn!(path = %partial.display(), error = %removal, "could not remove a partial archive");
                }

                return Err(error);
            }
        };
        let size = fs::metadata(&target)
            .map_err(|error| BackupError::io("read", &target, error))?
            .len();

        Ok(BackupSummary {
            archive: name,
            size,
            files: count,
            skipped_links: files.skipped_links(),
            skipped_special: files.skipped_special(),
            stopped: Vec::new(),
        })
    }

    /// The archives in `folder`, the newest first; none when it is not there.
    fn archives(folder: &Path) -> Result<Vec<BackupArchive>, BackupError> {
        let read = |error| BackupError::io("read", folder, error);
        let Some(entries) = BackupFiles::unless_gone(fs::read_dir(folder)).map_err(read)? else {
            return Ok(Vec::new());
        };
        let mut names = Vec::new();

        for entry in entries {
            let name = entry.map_err(read)?.file_name();
            let Some(name) = name
                .to_str()
                .and_then(|name| name.strip_suffix(ArchiveName::EXTENSION))
            else {
                continue;
            };

            if ArchiveName::is_valid(name) {
                names.push(name.to_owned());
            }
        }

        names.sort_unstable_by(|left, right| right.cmp(left));

        let mut archives = Vec::new();

        for name in names {
            let path = folder.join(format!("{name}{}", ArchiveName::EXTENSION));
            // Removed since the folder was read, by a prune or from the page: no longer one to list.
            let Some(metadata) = BackupFiles::unless_gone(fs::metadata(&path))
                .map_err(|error| BackupError::io("read", &path, error))?
            else {
                continue;
            };

            archives.push(BackupArchive {
                created_at: ArchiveName::created_at(&name),
                size: metadata.len(),
                name,
            });
        }

        Ok(archives)
    }

    /// Removes the partial archives in `folder` that a killed backup left.
    fn remove_partials(folder: &Path) -> Result<(), BackupError> {
        let entries =
            fs::read_dir(folder).map_err(|error| BackupError::io("read", folder, error))?;

        for entry in entries {
            let entry = entry.map_err(|error| BackupError::io("read", folder, error))?;
            let is_partial = entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(ArchiveName::PARTIAL_EXTENSION));

            if is_partial {
                let path = entry.path();

                BackupFiles::unless_gone(fs::remove_file(&path))
                    .map_err(|error| BackupError::io("remove", &path, error))?;
            }
        }

        Ok(())
    }

    /// `error`, an archive's, as [`BackupError::UnknownArchive`] when the archive is not there.
    fn unless_unknown(error: io::Error, path: &Path, app: &str, archive: &str) -> BackupError {
        if error.kind() == io::ErrorKind::NotFound {
            return BackupError::UnknownArchive {
                app: app.to_owned(),
                archive: archive.to_owned(),
            };
        }

        BackupError::io("read", path, error)
    }

    /// `error` and its sources, for the log.
    fn chain(error: &BackupError) -> String {
        let mut chain = error.to_string();
        let mut source = std::error::Error::source(error);

        while let Some(cause) = source {
            chain.push_str(": ");
            chain.push_str(&cause.to_string());
            source = cause.source();
        }

        chain
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::fs;
    use std::io::Read;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use tempfile::TempDir;
    use tokio_util::sync::CancellationToken;
    use zip::ExtraField;

    use super::{AppBackups, BackupError, BackupFiles};
    use crate::runtime::fake::{FakeRunner, Reply};
    use crate::{Backup, Command, CommandRunner, DataDir, Output, RunError};

    /// What `docker compose ps --status running --status restarting --format json` prints for `web`, in two containers
    /// running, and `db`, between two attempts of its restart policy.
    const RUNNING: &str = concat!(
        "{\"ID\":\"aaaaaaaaaaaa1111\",\"Service\":\"web\",\"State\":\"running\"}\n",
        "{\"ID\":\"bbbbbbbbbbbb2222\",\"Service\":\"web\",\"State\":\"running\"}\n",
        "{\"ID\":\"cccccccccccc3333\",\"Service\":\"db\",\"State\":\"restarting\"}\n",
    );

    /// A data directory where `alpha` is installed, its data folder holding `files`, each with its own path in it.
    fn data_dir(files: &[&str]) -> (TempDir, DataDir) {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let data_dir = DataDir::new(dir.path()).expect("the temporary directory resolves");
        let installed = data_dir.installed().join("alpha");

        fs::create_dir_all(&installed).expect("created");
        fs::write(installed.join("compose.yml"), "services: {}\n").expect("written");
        fs::create_dir_all(data_dir.app_data().join("alpha")).expect("created");

        for file in files {
            let path = data_dir.app_data().join("alpha").join(file);

            fs::create_dir_all(path.parent().expect("a parent")).expect("created");
            fs::write(&path, file).expect("written");
        }

        (dir, data_dir)
    }

    /// The backup of `alpha` as `hangar.yml` declares it by default.
    fn backup() -> Backup {
        Backup {
            app: "alpha".to_owned(),
            schedule: None,
            keep: 7,
            stop: false,
            path: None,
            include: vec!["**".to_owned()],
            exclude: Vec::new(),
        }
    }

    /// The entries of the zip at `path`, with their contents.
    fn entries(path: &Path) -> Vec<(String, String)> {
        let mut zip = zip::ZipArchive::new(fs::File::open(path).expect("opened")).expect("a zip");

        (0..zip.len())
            .map(|index| {
                let mut entry = zip.by_index(index).expect("an entry");
                let mut content = String::new();

                entry.read_to_string(&mut content).expect("read");

                (entry.name().expect("a name").into_owned(), content)
            })
            .collect()
    }

    /// The names in `alpha`'s folder of archives.
    fn archive_folder(data_dir: &DataDir) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(data_dir.backups().join("alpha"))
            .expect("read")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .into_string()
                    .expect("UTF-8")
            })
            .collect();

        names.sort();
        names
    }

    /// The fake runner, which also notes, at each `docker compose start`, how many archives are written by then.
    struct CountsArchivesAtStart<'a> {
        fake: &'a FakeRunner,
        folder: PathBuf,
        at_start: Mutex<Vec<usize>>,
    }

    impl CommandRunner for CountsArchivesAtStart<'_> {
        async fn run(&self, command: &Command, output: Output) -> Result<(), RunError> {
            self.fake.run(command, output).await
        }

        async fn capture(&self, command: &Command) -> Result<String, RunError> {
            if command.args.iter().any(|arg| arg == "start") {
                let archives = fs::read_dir(&self.folder)
                    .map(|entries| {
                        entries
                            .filter(|entry| {
                                entry.as_ref().is_ok_and(|entry| {
                                    entry.file_name().to_string_lossy().ends_with(".zip")
                                })
                            })
                            .count()
                    })
                    .unwrap_or(0);

                self.at_start
                    .lock()
                    .expect("no test panics with the lock")
                    .push(archives);
            }

            self.fake.capture(command).await
        }
    }

    /// A runner that removes `alpha`'s compose file once its services are stopped, as a sync or an edit may.
    struct RemovesComposeFileAtStop<'a> {
        fake: &'a FakeRunner,
        file: PathBuf,
    }

    impl CommandRunner for RemovesComposeFileAtStop<'_> {
        async fn run(&self, command: &Command, output: Output) -> Result<(), RunError> {
            self.fake.run(command, output).await
        }

        async fn capture(&self, command: &Command) -> Result<String, RunError> {
            let captured = self.fake.capture(command).await;

            if command.args.iter().any(|arg| arg == "stop") {
                fs::remove_file(&self.file).expect("removed");
            }

            captured
        }
    }

    /// What each compose call ran, after the app's project, and its file when it names one.
    fn compose_calls(runs: &[Command]) -> Vec<String> {
        runs.iter()
            .map(|run| {
                let after = match run.args.iter().position(|arg| arg == "-f") {
                    Some(file) => file + 2,
                    None => {
                        run.args
                            .iter()
                            .position(|arg| arg == "-p")
                            .expect("a project")
                            + 2
                    }
                };

                run.args[after..].join(" ")
            })
            .collect()
    }

    #[tokio::test]
    async fn writes_an_archive_that_reads_back_its_entries_under_the_folder_s_path() {
        let (_dir, data_dir) = data_dir(&["config/app.ini", ".env", "db/data.db"]);
        let ini = data_dir.app_data().join("alpha/config/app.ini");

        fs::set_permissions(&ini, fs::Permissions::from_mode(0o640)).expect("set");

        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(&backup(), &CancellationToken::new())
            .await
            .expect("backed up");
        let path = data_dir
            .backups()
            .join("alpha")
            .join(format!("{}.zip", summary.archive));

        assert_eq!(summary.files, 3);
        assert_eq!(summary.size, fs::metadata(&path).expect("there").len());
        assert_eq!(
            entries(&path),
            [
                ("alpha/.env".to_owned(), ".env".to_owned()),
                (
                    "alpha/config/app.ini".to_owned(),
                    "config/app.ini".to_owned()
                ),
                ("alpha/db/data.db".to_owned(), "db/data.db".to_owned()),
            ]
        );

        let mut zip = zip::ZipArchive::new(fs::File::open(&path).expect("opened")).expect("a zip");
        let mode = zip
            .by_name("alpha/config/app.ini")
            .expect("the entry")
            .unix_mode();

        assert_eq!(mode.map(|mode| mode & 0o7777), Some(0o640));
        assert_eq!(
            archive_folder(&data_dir),
            [format!("{}.zip", summary.archive)]
        );
        assert!(runner.runs().is_empty(), "no compose command without stop");

        let listed = backups.list("alpha").await.expect("listed");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, summary.archive);
        assert_eq!(listed[0].size, summary.size);
        assert!(listed[0].created_at.ends_with('Z'));
    }

    #[tokio::test]
    async fn backs_up_the_folder_it_names_with_its_globs_and_follows_no_link() {
        let (_dir, data_dir) = data_dir(&[
            "config/app.ini",
            "config/cache/blob.ini",
            "config/notes.txt",
            "media/movie.mkv",
        ]);
        let outside = tempfile::tempdir().expect("a temporary directory");

        fs::write(outside.path().join("secret.ini"), "secret").expect("written");
        symlink(
            outside.path(),
            data_dir.app_data().join("alpha/config/linked"),
        )
        .expect("linked");

        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(
                &Backup {
                    path: Some("alpha/config".to_owned()),
                    include: vec!["**/*.ini".to_owned()],
                    exclude: vec!["cache/**".to_owned()],
                    ..backup()
                },
                &CancellationToken::new(),
            )
            .await
            .expect("backed up");
        let path = data_dir
            .backups()
            .join("alpha")
            .join(format!("{}.zip", summary.archive));
        let names: Vec<String> = entries(&path).into_iter().map(|(name, _)| name).collect();

        assert_eq!(names, ["alpha/config/app.ini"]);
        assert_eq!(summary.skipped_links, 1);
    }

    #[tokio::test]
    async fn keeps_the_newest_archives_and_removes_a_partial_one_left_behind() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let folder = data_dir.backups().join("alpha");

        fs::create_dir_all(&folder).expect("created");

        for name in [
            "2020-01-01T00-00-00-000Z.zip",
            "2021-01-01T00-00-00-000Z.zip",
            "2022-01-01T00-00-00-000Z.zip",
            "2023-01-01T00-00-00-000Z.zip.partial",
            "notes.txt",
        ] {
            fs::write(folder.join(name), name).expect("written");
        }

        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(
                &Backup {
                    keep: 2,
                    ..backup()
                },
                &CancellationToken::new(),
            )
            .await
            .expect("backed up");

        assert_eq!(
            archive_folder(&data_dir),
            [
                "2022-01-01T00-00-00-000Z.zip".to_owned(),
                format!("{}.zip", summary.archive),
                "notes.txt".to_owned(),
            ]
        );

        let listed: Vec<String> = backups
            .list("alpha")
            .await
            .expect("listed")
            .into_iter()
            .map(|archive| archive.name)
            .collect();

        assert_eq!(
            listed,
            [summary.archive, "2022-01-01T00-00-00-000Z".to_owned()]
        );
    }

    #[tokio::test]
    async fn stops_the_running_services_then_starts_them_again_after_the_archive() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let fake = FakeRunner::new();
        let runner = CountsArchivesAtStart {
            fake: &fake,
            folder: data_dir.backups().join("alpha"),
            at_start: Mutex::default(),
        };

        fake.reply(Reply::Success {
            stdout: RUNNING.to_owned(),
        });

        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(
                &Backup {
                    stop: true,
                    ..backup()
                },
                &CancellationToken::new(),
            )
            .await
            .expect("backed up");

        assert_eq!(summary.stopped, ["web", "db"]);
        assert_eq!(
            compose_calls(&fake.runs()),
            [
                "ps --status running --status restarting --format json",
                "stop web db",
                "start web db"
            ]
        );
        assert_eq!(
            *runner.at_start.lock().expect("the lock"),
            [1],
            "started once the archive is written"
        );
        assert_eq!(archive_folder(&data_dir).len(), 1);
    }

    #[tokio::test]
    async fn starts_the_services_again_when_the_archive_fails_and_says_when_they_do_not() {
        for start_fails in [false, true] {
            let (_dir, data_dir) = data_dir(&["data.db"]);
            let runner = FakeRunner::new();

            // A file where the folder of the archives goes: the archive cannot be written.
            fs::write(data_dir.backups(), "in the way").expect("written");
            runner.reply(Reply::Success {
                stdout: RUNNING.to_owned(),
            });
            runner.reply(Reply::Success {
                stdout: String::new(),
            });

            if start_fails {
                runner.reply(Reply::Failure {
                    code: 1,
                    stderr: "no such service".to_owned(),
                });
            }

            let backups = AppBackups::with_hostname(data_dir, &runner, None);
            let failed = backups
                .back_up(
                    &Backup {
                        stop: true,
                        ..backup()
                    },
                    &CancellationToken::new(),
                )
                .await;

            assert_eq!(
                compose_calls(&runner.runs()),
                [
                    "ps --status running --status restarting --format json",
                    "stop web db",
                    "start web db"
                ]
            );

            match failed {
                Err(BackupError::NotRestarted {
                    services, failure, ..
                }) if start_fails => {
                    assert_eq!(services, ["web", "db"]);
                    assert!(matches!(failure.as_deref(), Some(BackupError::Io { .. })));
                }
                Err(BackupError::Io { action, .. }) if !start_fails => assert_eq!(action, "create"),
                other => panic!("unexpected: {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn stops_nothing_when_a_service_runs_in_the_container_hangar_runs_in() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let runner = FakeRunner::new();

        runner.reply(Reply::Success {
            stdout: RUNNING.to_owned(),
        });

        let backups =
            AppBackups::with_hostname(data_dir.clone(), &runner, Some("cccccccccccc".to_owned()));
        let refused = backups
            .back_up(
                &Backup {
                    stop: true,
                    ..backup()
                },
                &CancellationToken::new(),
            )
            .await;

        assert!(matches!(refused, Err(BackupError::RunsHangar { app }) if app == "alpha"));
        assert_eq!(
            compose_calls(&runner.runs()),
            ["ps --status running --status restarting --format json"]
        );
        assert!(!data_dir.backups().join("alpha").exists());
    }

    #[tokio::test]
    async fn refuses_a_data_folder_that_is_missing_or_leads_out_of_app_data_before_it_stops_anything()
     {
        let (_dir, data_dir) = data_dir(&[]);
        let outside = tempfile::tempdir().expect("a temporary directory");
        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let stopping = |path: &str| Backup {
            stop: true,
            path: Some(path.to_owned()),
            ..backup()
        };

        symlink(outside.path(), data_dir.app_data().join("escape")).expect("linked");

        let missing = backups
            .back_up(&stopping("beta"), &CancellationToken::new())
            .await;
        let escaping = backups
            .back_up(&stopping("escape"), &CancellationToken::new())
            .await;

        assert!(matches!(missing, Err(BackupError::NoDataFolder { .. })));
        assert!(matches!(escaping, Err(BackupError::LinkedFolder { .. })));
        assert!(runner.runs().is_empty());
    }

    #[tokio::test]
    async fn removes_what_it_wrote_once_canceled() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let canceled = CancellationToken::new();
        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);

        canceled.cancel();

        let refused = backups.back_up(&backup(), &canceled).await;

        assert!(matches!(refused, Err(BackupError::Canceled { .. })));

        // Canceled while it writes: what it wrote goes.
        let folder = data_dir.backups().join("alpha");
        let root = BackupFiles::open_root(data_dir.app_data(), "alpha", "alpha").expect("opened");
        let files = BackupFiles::new(
            root,
            data_dir.app_data().join("alpha"),
            &["**".to_owned()],
            &[],
        )
        .expect("valid globs");
        let written = AppBackups::<FakeRunner>::write(&folder, "alpha", files, &canceled);

        assert!(written.is_err());
        assert!(archive_folder(&data_dir).is_empty());
    }

    #[tokio::test]
    async fn starts_the_services_listed_again_when_their_stop_fails() {
        for start_fails in [false, true] {
            let (_dir, data_dir) = data_dir(&["data.db"]);
            let runner = FakeRunner::new();

            runner.reply(Reply::Success {
                stdout: RUNNING.to_owned(),
            });
            // `web` stopped, then `db` did not.
            runner.reply(Reply::Failure {
                code: 1,
                stderr: "db: timeout".to_owned(),
            });

            if start_fails {
                runner.reply(Reply::Failure {
                    code: 1,
                    stderr: "web: no such container".to_owned(),
                });
            }

            let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
            let failed = backups
                .back_up(
                    &Backup {
                        stop: true,
                        ..backup()
                    },
                    &CancellationToken::new(),
                )
                .await;

            assert_eq!(
                compose_calls(&runner.runs()),
                [
                    "ps --status running --status restarting --format json",
                    "stop web db",
                    "start web db"
                ]
            );
            assert!(
                !data_dir.backups().join("alpha").exists(),
                "nothing archived"
            );

            match failed {
                Err(BackupError::NotRestarted {
                    services, failure, ..
                }) if start_fails => {
                    assert_eq!(services, ["web", "db"]);
                    assert!(matches!(
                        failure.as_deref(),
                        Some(BackupError::NotStopped { .. })
                    ));
                }
                Err(BackupError::NotStopped { .. }) if !start_fails => {}
                other => panic!("unexpected: {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn names_each_entry_by_its_bytes_and_gives_its_time_as_an_extended_timestamp() {
        let (_dir, data_dir) = data_dir(&[]);
        let folder = data_dir.app_data().join("alpha");
        // Two names that differ only in bytes that are not UTF-8, beside the name both would be made into.
        let names: [&[u8]; 3] = [b"a\xff.txt", b"a\xfe.txt", "a\u{fffd}.txt".as_bytes()];

        for name in names {
            fs::write(folder.join(OsStr::from_bytes(name)), name).expect("written");
        }

        let file = fs::File::options()
            .write(true)
            .open(folder.join(OsStr::from_bytes(names[0])))
            .expect("opened");
        let changed = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_760_758_200);

        file.set_modified(changed).expect("set");

        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(&backup(), &CancellationToken::new())
            .await
            .expect("backed up");
        let path = data_dir
            .backups()
            .join("alpha")
            .join(format!("{}.zip", summary.archive));
        let mut zip = zip::ZipArchive::new(fs::File::open(&path).expect("opened")).expect("a zip");
        let mut raw: Vec<Vec<u8>> = zip.file_names_raw().map(<[u8]>::to_vec).collect();

        raw.sort();

        let mut expected: Vec<Vec<u8>> = names
            .iter()
            .map(|name| [b"alpha/", *name].concat())
            .collect();

        expected.sort();

        assert_eq!(summary.files, 3);
        assert_eq!(raw, expected);

        let index = zip
            .index_for_name_raw(&[b"alpha/", names[0]].concat())
            .expect("the entry");
        let entry = zip.by_index(index).expect("read");
        let modified = entry.extra_data_fields().find_map(|field| match field {
            ExtraField::ExtendedTimestamp(timestamp) => timestamp.mod_time(),
            _ => None,
        });

        assert_eq!(modified, Some(1_760_758_200));
    }

    #[tokio::test]
    async fn refuses_a_link_anywhere_in_the_folder_s_path_even_one_that_stays_under_app_data() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let app_data = data_dir.app_data();

        fs::create_dir_all(app_data.join("beta/config")).expect("created");
        fs::write(app_data.join("beta/config/secret.txt"), "beta's").expect("written");
        symlink("alpha", app_data.join("gamma")).expect("linked");
        symlink("../beta/config", app_data.join("alpha/config")).expect("linked");
        symlink(".", app_data.join("self")).expect("linked");

        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);

        for path in ["gamma", "alpha/config", "self"] {
            let refused = backups
                .back_up(
                    &Backup {
                        path: Some(path.to_owned()),
                        ..backup()
                    },
                    &CancellationToken::new(),
                )
                .await;

            assert!(
                matches!(refused, Err(BackupError::LinkedFolder { .. })),
                "{path}: {refused:?}"
            );
        }

        for path in [".", "alpha/..", "/etc", "alpha//data"] {
            assert!(
                matches!(
                    BackupFiles::open_root(app_data, "alpha", path),
                    Err(BackupError::OutsideAppData { .. })
                ),
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn stops_and_starts_by_the_project_s_name_whatever_its_compose_file_says_by_then() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let fake = FakeRunner::new();
        let runner = RemovesComposeFileAtStop {
            fake: &fake,
            file: data_dir.installed().join("alpha/compose.yml"),
        };

        fake.reply(Reply::Success {
            stdout: RUNNING.to_owned(),
        });

        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(
                &Backup {
                    stop: true,
                    ..backup()
                },
                &CancellationToken::new(),
            )
            .await
            .expect("backed up and started again, with no compose file left");
        let runs = fake.runs();

        assert_eq!(summary.stopped, ["web", "db"]);

        // Compose lists, stops and starts a project by its containers' labels, in their order: no file is read.
        for (run, command) in runs.iter().zip([
            "ps --status running --status restarting --format json",
            "stop web db",
            "start web db",
        ]) {
            assert_eq!(run.program, "docker");
            assert_eq!(run.args.join(" "), format!("compose -p alpha {command}"));
        }

        assert_eq!(runs.len(), 3);
    }

    #[tokio::test]
    async fn runs_the_backups_of_one_app_in_turn() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let runner = FakeRunner::new();

        for _ in 0..2 {
            runner.reply(Reply::Success {
                stdout: RUNNING.to_owned(),
            });
            runner.reply(Reply::Success {
                stdout: String::new(),
            });
            runner.reply(Reply::Success {
                stdout: String::new(),
            });
        }

        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let stopping = Backup {
            stop: true,
            ..backup()
        };
        let cancel = CancellationToken::new();
        let (first, second) = tokio::join!(
            backups.back_up(&stopping, &cancel),
            backups.back_up(&stopping, &cancel)
        );

        first.expect("backed up");
        second.expect("backed up");

        let one = [
            "ps --status running --status restarting --format json",
            "stop web db",
            "start web db",
        ];

        assert_eq!(compose_calls(&runner.runs()), [one, one].concat());
        assert_eq!(
            archive_folder(&data_dir).len(),
            2,
            "neither replaced the other"
        );
    }

    #[tokio::test]
    async fn reads_and_removes_an_archive_by_its_name_alone() {
        let (_dir, data_dir) = data_dir(&["data.db"]);
        let runner = FakeRunner::new();
        let backups = AppBackups::with_hostname(data_dir.clone(), &runner, None);
        let summary = backups
            .back_up(&backup(), &CancellationToken::new())
            .await
            .expect("backed up");
        let file = backups
            .file("alpha", &summary.archive)
            .await
            .expect("found");

        assert_eq!(file.download_name, format!("alpha-{}.zip", summary.archive));
        assert_eq!(file.size, summary.size);

        backups
            .remove("alpha", &summary.archive)
            .await
            .expect("removed");

        assert!(matches!(
            backups.file("alpha", &summary.archive).await,
            Err(BackupError::UnknownArchive { .. })
        ));
        assert!(matches!(
            backups.remove("alpha", &summary.archive).await,
            Err(BackupError::UnknownArchive { .. })
        ));
        assert!(matches!(
            backups.file("alpha", "../../.env.global").await,
            Err(BackupError::InvalidArchive { .. })
        ));
        assert!(matches!(
            backups.list("../app-data").await,
            Err(BackupError::InvalidApp { .. })
        ));
        assert!(backups.list("beta").await.expect("listed").is_empty());
    }
}
