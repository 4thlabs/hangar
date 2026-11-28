//! The backups of the apps' data folders, on the core's [`AppBackups`]: the job that backs an app up, on its cron of
//! `hangar.yml` or when a user asks, with its six hours at most and its notifications, and the routes that list,
//! download and remove the archives.

mod routes;

use std::sync::Arc;
use std::time::Duration;

use hangar_api::{BackupPlan, ErrorCode, ErrorDetail, NotificationLevel, NotificationMessage};
use hangar_core::{
    AppBackups, Backup, BackupError, BackupSummary, CancellationToken, Config, Runtime, Store,
};

use crate::Settings;
use crate::app_locks::AppLocks;
use crate::failure::Failure;
use crate::notifications::{Notification, Notifier};

/// What the backups run on: the store, whose `hangar.yml` declares them, the core's backups, the apps the commands hold,
/// and the notifications.
#[derive(Debug)]
pub(crate) struct Backups {
    store: Store<Runtime>,
    backups: AppBackups<Runtime>,
    locks: Arc<AppLocks>,
    notifier: Notifier,
    /// The longest a backup runs, [`TIMEOUT`](Self::TIMEOUT) but in a test.
    timeout: Duration,
}

impl Backups {
    /// The longest a backup runs: it is canceled then, which removes what it wrote and starts again what it stopped.
    const TIMEOUT: Duration = Duration::from_secs(6 * 3600);

    /// The backups of the server's settings, their compose commands run by `runtime`, a backup that stops its services
    /// holding its app in `locks`, their failures filed with `notifier`.
    pub(crate) fn new(
        settings: &Settings,
        runtime: Runtime,
        locks: Arc<AppLocks>,
        notifier: Notifier,
    ) -> Self {
        Self {
            store: Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime.clone(),
            ),
            backups: AppBackups::new(settings.data_dir.clone(), runtime),
            locks,
            notifier,
            timeout: Self::TIMEOUT,
        }
    }

    /// The `hangar.yml` of the store.
    ///
    /// # Errors
    ///
    /// The code of a `hangar.yml` that cannot be read, or does not parse.
    pub(crate) async fn config(&self) -> Result<Config, ErrorCode> {
        self.store
            .config()
            .await
            .map_err(|error| Failure::store_code(ErrorCode::ConfigUnreadable, &error))
    }

    /// The plan of `backup`, as the page shows it.
    pub(crate) fn plan(backup: &Backup) -> BackupPlan {
        BackupPlan {
            schedule: backup.schedule.clone(),
            keep: backup.keep,
            stop: backup.stop,
        }
    }

    /// Backs `app` up as `hangar.yml` declares it now, for six hours at most; once `cancel` is cancelled, it ends what
    /// it does, as the core's backup says, and is no failure. A failure is notified, `backupFailed`, and a stop whose
    /// services did not start again `backupRestartFailed`, with the failure of the backup when it failed too.
    ///
    /// A backup that stops the services holds its app from before it reads which run to after it starts them again: no
    /// batch, install, uninstall or update of the apps recreates or takes down what it stopped meanwhile. It does not
    /// wait for another command that holds the app.
    ///
    /// # Errors
    ///
    /// `backups.not_declared` when `hangar.yml` no longer declares it, `compose.app_busy` when it stops the services
    /// and another command holds the app, `backups.timed_out` past its six hours, and the code of its failure, logged.
    pub(crate) async fn back_up(
        &self,
        app: &str,
        cancel: &CancellationToken,
    ) -> Result<(), ErrorCode> {
        let held = self.declared(app).await.and_then(|backup| {
            let claim = backup
                .stop
                .then(|| self.locks.claim_backup(app))
                .transpose()?;

            Ok((backup, claim))
        });
        // Held until the services stopped are started again, which the core's backup does before it ends.
        let (backup, _claim) = match held {
            Ok(held) => held,
            Err(code) => {
                self.notify_failed(app, code.clone());
                return Err(code);
            }
        };
        let (backed_up, timed_out) = self.run(&backup, cancel).await;
        let Err(error) = backed_up else {
            return Ok(());
        };

        if let BackupError::NotRestarted {
            services, failure, ..
        } = &error
        {
            self.notify_restart_failed(app, services.clone());

            if let Some(failure) = failure
                && let Some(code) = Self::code(&backup, failure, timed_out)
            {
                self.notify_failed(app, Failure::logged_code(code, &**failure));
            }
        }

        // Canceled by the user, which is no failure.
        let Some(code) = Self::code(&backup, &error, timed_out) else {
            return Ok(());
        };
        let code = Failure::logged_code(code, &error);

        if !matches!(error, BackupError::NotRestarted { .. }) {
            self.notify_failed(app, code.clone());
        }

        Err(code)
    }

    /// The backup of `app` that `hangar.yml` declares.
    ///
    /// # Errors
    ///
    /// The code of a `hangar.yml` that cannot be read, and `backups.not_declared` when it declares none.
    pub(crate) async fn declared(&self, app: &str) -> Result<Backup, ErrorCode> {
        self.config()
            .await?
            .backup(app)
            .cloned()
            .ok_or_else(|| ErrorCode::BackupNotDeclared {
                app: app.to_owned(),
            })
    }

    /// Runs `backup` for six hours at most, and tells whether it ran past them. The core's backup is always awaited to
    /// its end, past its six hours too, canceled through its token: dropped once it has stopped the services, it would
    /// never start them again.
    async fn run(
        &self,
        backup: &Backup,
        cancel: &CancellationToken,
    ) -> (Result<BackupSummary, BackupError>, bool) {
        // Its own token, which the timeout cancels: the run's own is the user's, which ends it canceled.
        let stopping = cancel.child_token();
        let running = self.backups.back_up(backup, &stopping);

        tokio::pin!(running);

        tokio::select! {
            backed_up = &mut running => (backed_up, false),
            () = tokio::time::sleep(self.timeout) => {
                tracing::warn!(app = %backup.app, "a backup ran past its six hours: it is canceled");
                stopping.cancel();

                (running.await, true)
            }
        }
    }

    /// The code of `error`, a failure of `backup`, which `timed_out` says ran past its six hours; `None` for one
    /// canceled by the user, which is no failure.
    fn code(backup: &Backup, error: &BackupError, timed_out: bool) -> Option<ErrorCode> {
        let app = || backup.app.clone();
        let folder = || backup.path.clone().unwrap_or_else(app);
        let code = match error {
            BackupError::Canceled { .. } if timed_out => ErrorCode::BackupTimedOut { app: app() },
            BackupError::Canceled { .. } => return None,
            BackupError::NotRestarted { services, .. } => ErrorCode::NotRestarted {
                app: app(),
                services: services.clone(),
            },
            BackupError::NoDataFolder { .. } => ErrorCode::NoDataFolder {
                app: app(),
                folder: folder(),
            },
            BackupError::LinkedFolder { .. } => ErrorCode::LinkedDataFolder {
                app: app(),
                folder: folder(),
            },
            BackupError::OutsideAppData { .. } => ErrorCode::DataFolderOutside {
                app: app(),
                folder: folder(),
            },
            BackupError::InvalidGlob { glob, .. } => ErrorCode::InvalidGlob { glob: glob.clone() },
            BackupError::RunsHangar { .. } => ErrorCode::RunsHangar { app: app() },
            BackupError::NotStopped { .. } | BackupError::UnreadableServices { .. } => {
                ErrorCode::NotStopped { app: app() }
            }
            // The core's error is non-exhaustive, so a wildcard is needed: what it adds, and an archive that could
            // not be written, is the backup failed, which the log says.
            _ => ErrorCode::BackupFailed { app: app() },
        };

        Some(code)
    }

    /// Notifies `backupRestartFailed` for `app`, whose `services` did not start again.
    fn notify_restart_failed(&self, app: &str, services: Vec<String>) {
        self.notifier.notify(Notification {
            level: NotificationLevel::Error,
            message: NotificationMessage::BackupRestartFailed {
                app: app.to_owned(),
                services,
            },
            href: Some(Self::href(app)),
            dedupe_key: Some(format!("backup-restart:{app}")),
        });
    }

    /// Notifies `backupFailed` for `app`, failed with `code`.
    fn notify_failed(&self, app: &str, code: ErrorCode) {
        self.notifier.notify(Notification {
            level: NotificationLevel::Error,
            message: NotificationMessage::BackupFailed {
                app: app.to_owned(),
                error: ErrorDetail::from(code),
            },
            href: Some(Self::href(app)),
            dedupe_key: Some(format!("backup:{app}")),
        });
    }

    /// The page of `app`, which its backups' notifications lead to.
    fn href(app: &str) -> String {
        format!("/apps/{app}")
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    use hangar_api::{ErrorCode, ErrorDetail, NotificationMessage};
    use hangar_core::{CancellationToken, Runtime};

    use super::Backups;
    use crate::Settings;
    use crate::app_locks::AppLocks;
    use crate::notifications::Notifier;

    /// The fake `docker`: it logs its arguments, one call per line, after the app's compose file; answers `ps` with
    /// `web` running; takes `HANGAR_TEST_STOP` seconds to stop it; and starts it again with the exit code
    /// `HANGAR_TEST_START`.
    const FAKE_DOCKER: &str = r#"#!/bin/sh
echo "$*" | sed 's/.* -f [^ ]* //' >> "$HANGAR_TEST_LOG"
case " $* " in
  *" ps "*) echo '{"ID":"aaaaaaaaaaaa1111","Service":"web","State":"running"}' ;;
  *" stop "*) sleep "${HANGAR_TEST_STOP:-0}" ;;
  *" start "*) exit "${HANGAR_TEST_START:-0}" ;;
esac
"#;

    /// A data directory where `alpha` is installed, with a file in its data folder, and backed up by `hangar.yml`,
    /// its services stopped; the fake `docker`, and the log of its calls.
    struct Fixture {
        dir: tempfile::TempDir,
        settings: Settings,
        locks: Arc<AppLocks>,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("a temporary directory");
            let data = dir.path().join("data");
            let store = data.join("app-store");
            let installed = data.join("app-installed/alpha");
            let bin = dir.path().join("bin");

            for folder in [&store.join(".git"), &store.join("config"), &installed, &bin] {
                fs::create_dir_all(folder).expect("created");
            }

            fs::create_dir_all(data.join("app-data/alpha")).expect("created");
            fs::write(data.join("app-data/alpha/app.ini"), "kept").expect("written");
            fs::write(installed.join("compose.yml"), "services: {}\n").expect("written");
            fs::write(
                store.join("config/hangar.yml"),
                "categories: []\nbackups:\n  - { app: alpha, stop: true }\n  - { app: beta, path: beta/config }\n",
            )
            .expect("written");
            fs::write(bin.join("docker"), FAKE_DOCKER).expect("written");
            fs::set_permissions(bin.join("docker"), fs::Permissions::from_mode(0o755))
                .expect("made executable");

            let data = data.to_str().expect("UTF-8").to_owned();
            let settings = Settings::read(|name| match name {
                "HANGAR_DATA_DIR" => Some(data.clone()),
                "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
                "DOMAIN" => Some("example.com".to_owned()),
                "HANGAR_URL" => Some("https://hangar.example.com".to_owned()),
                "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
                _ => None,
            })
            .expect("the settings are valid");

            Self {
                dir,
                settings,
                locks: Arc::default(),
            }
        }

        /// The backups, their fake `docker` taking `stop` seconds to stop and starting with the exit code `start`,
        /// and running for `timeout` at most; and their notifications.
        async fn backups(&self, stop: u64, start: i32, timeout: Duration) -> (Backups, Notifier) {
            let path = std::env::var("PATH").unwrap_or_default();
            let runtime = Runtime::new().envs([
                (
                    "PATH",
                    format!("{}:{path}", self.dir.path().join("bin").display()),
                ),
                ("HANGAR_TEST_LOG", self.log().display().to_string()),
                ("HANGAR_TEST_STOP", stop.to_string()),
                ("HANGAR_TEST_START", start.to_string()),
            ]);
            let notifier = Notifier::load(&self.settings.data_dir).await;
            let mut backups = Backups::new(
                &self.settings,
                runtime,
                Arc::clone(&self.locks),
                notifier.clone(),
            );

            backups.timeout = timeout;

            (backups, notifier)
        }

        fn log(&self) -> PathBuf {
            self.dir.path().join("docker.log")
        }

        /// The compose commands the fake `docker` ran, after the app's compose file.
        fn calls(&self) -> Vec<String> {
            fs::read_to_string(self.log())
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect()
        }

        /// The archives of `alpha`.
        fn archives(&self) -> Vec<String> {
            Self::names(&self.settings.data_dir.backups().join("alpha"))
        }

        fn names(folder: &Path) -> Vec<String> {
            fs::read_dir(folder)
                .map(|entries| {
                    entries
                        .map(|entry| {
                            entry
                                .expect("an entry")
                                .file_name()
                                .to_string_lossy()
                                .into_owned()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
    }

    /// What `notifier` holds, the oldest first.
    fn notified(notifier: &Notifier) -> Vec<NotificationMessage> {
        let mut messages: Vec<NotificationMessage> = notifier
            .recent()
            .notifications
            .into_iter()
            .map(|notification| notification.message)
            .collect();

        messages.reverse();
        messages
    }

    /// The compose commands a backup that stops `web` runs, in order.
    fn stopped_and_started() -> Vec<String> {
        [
            "ps --status running --status restarting --format json",
            "stop web",
            "start web",
        ]
        .map(str::to_owned)
        .to_vec()
    }

    #[tokio::test]
    async fn backs_an_app_up_between_the_stop_and_the_start_of_its_services() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(0, 0, Backups::TIMEOUT).await;

        backups
            .back_up("alpha", &CancellationToken::new())
            .await
            .expect("backed up");

        assert_eq!(fixture.calls(), stopped_and_started());
        assert_eq!(fixture.archives().len(), 1);
        assert!(
            notified(&notifier).is_empty(),
            "a backup that works says nothing"
        );
    }

    #[tokio::test]
    async fn cancels_a_backup_past_its_time_and_starts_again_what_it_stopped() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(1, 0, Duration::from_millis(100)).await;
        let timed_out = ErrorCode::BackupTimedOut {
            app: "alpha".to_owned(),
        };

        assert_eq!(
            backups.back_up("alpha", &CancellationToken::new()).await,
            Err(timed_out.clone())
        );
        assert_eq!(fixture.calls(), stopped_and_started());
        assert!(fixture.archives().is_empty(), "what it wrote is removed");
        assert_eq!(
            notified(&notifier),
            [NotificationMessage::BackupFailed {
                app: "alpha".to_owned(),
                error: ErrorDetail::from(timed_out),
            }]
        );
    }

    #[tokio::test]
    async fn notifies_the_services_that_did_not_start_again_and_why_the_backup_failed() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(1, 1, Duration::from_millis(100)).await;

        assert_eq!(
            backups.back_up("alpha", &CancellationToken::new()).await,
            Err(ErrorCode::NotRestarted {
                app: "alpha".to_owned(),
                services: vec!["web".to_owned()],
            })
        );
        assert_eq!(
            notified(&notifier),
            [
                NotificationMessage::BackupRestartFailed {
                    app: "alpha".to_owned(),
                    services: vec!["web".to_owned()],
                },
                NotificationMessage::BackupFailed {
                    app: "alpha".to_owned(),
                    error: ErrorDetail::from(ErrorCode::BackupTimedOut {
                        app: "alpha".to_owned()
                    }),
                },
            ]
        );
    }

    #[tokio::test]
    async fn notifies_a_restart_that_failed_alone_when_the_archive_was_written() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(0, 1, Backups::TIMEOUT).await;

        assert!(matches!(
            backups.back_up("alpha", &CancellationToken::new()).await,
            Err(ErrorCode::NotRestarted { .. })
        ));
        assert_eq!(fixture.archives().len(), 1);
        assert_eq!(
            notified(&notifier),
            [NotificationMessage::BackupRestartFailed {
                app: "alpha".to_owned(),
                services: vec!["web".to_owned()],
            }]
        );
    }

    #[tokio::test]
    async fn ends_a_backup_canceled_by_the_user_as_no_failure() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(0, 0, Backups::TIMEOUT).await;
        let cancel = CancellationToken::new();

        cancel.cancel();

        assert_eq!(backups.back_up("alpha", &cancel).await, Ok(()));
        assert!(fixture.archives().is_empty());
        assert!(notified(&notifier).is_empty());
    }

    #[tokio::test]
    async fn fails_the_backup_of_an_app_not_declared_or_of_a_folder_not_there_and_says_why() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(0, 0, Backups::TIMEOUT).await;
        let not_declared = ErrorCode::BackupNotDeclared {
            app: "gamma".to_owned(),
        };
        let no_folder = ErrorCode::NoDataFolder {
            app: "beta".to_owned(),
            folder: "beta/config".to_owned(),
        };

        assert_eq!(
            backups.back_up("gamma", &CancellationToken::new()).await,
            Err(not_declared.clone())
        );
        assert_eq!(
            backups.back_up("beta", &CancellationToken::new()).await,
            Err(no_folder.clone())
        );
        assert!(fixture.calls().is_empty(), "nothing was stopped");
        assert_eq!(
            notified(&notifier),
            [
                NotificationMessage::BackupFailed {
                    app: "gamma".to_owned(),
                    error: ErrorDetail::from(not_declared),
                },
                NotificationMessage::BackupFailed {
                    app: "beta".to_owned(),
                    error: ErrorDetail::from(no_folder),
                },
            ]
        );
    }

    #[tokio::test]
    async fn fails_at_once_a_backup_that_stops_the_services_of_an_app_another_command_holds() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(0, 0, Backups::TIMEOUT).await;
        let batch = fixture
            .locks
            .claim_batch(["alpha"])
            .expect("nothing is held");
        let busy = ErrorCode::AppBusy {
            app: "alpha".to_owned(),
        };

        assert_eq!(
            backups.back_up("alpha", &CancellationToken::new()).await,
            Err(busy.clone())
        );
        assert!(fixture.calls().is_empty(), "nothing was stopped");
        assert_eq!(
            notified(&notifier),
            [NotificationMessage::BackupFailed {
                app: "alpha".to_owned(),
                error: ErrorDetail::from(busy),
            }]
        );

        drop(batch);
        backups
            .back_up("alpha", &CancellationToken::new())
            .await
            .expect("backed up once released");

        assert!(
            fixture.locks.claim_batch(["alpha"]).is_ok(),
            "the backup let its app go once its services started again"
        );
    }

    #[tokio::test]
    async fn holds_nothing_for_a_backup_that_stops_no_service() {
        let fixture = Fixture::new();
        let (backups, _notifier) = fixture.backups(0, 0, Backups::TIMEOUT).await;
        let _batch = fixture
            .locks
            .claim_batch(["beta"])
            .expect("nothing is held");

        // Beta's folder is not there: what fails is its backup, not a claim of its app.
        assert!(matches!(
            backups.back_up("beta", &CancellationToken::new()).await,
            Err(ErrorCode::NoDataFolder { .. })
        ));
    }

    #[tokio::test]
    async fn fails_at_once_a_backup_that_stops_the_services_while_the_store_is_synced() {
        let fixture = Fixture::new();
        let (backups, notifier) = fixture.backups(0, 0, Backups::TIMEOUT).await;
        let _sync = fixture.locks.claim_sync().expect("nothing is held");
        let busy = ErrorCode::AppBusy {
            app: "alpha".to_owned(),
        };

        assert_eq!(
            backups.back_up("alpha", &CancellationToken::new()).await,
            Err(busy.clone())
        );
        assert!(fixture.calls().is_empty(), "nothing was stopped");
        assert_eq!(
            notified(&notifier),
            [NotificationMessage::BackupFailed {
                app: "alpha".to_owned(),
                error: ErrorDetail::from(busy),
            }]
        );
    }
}
