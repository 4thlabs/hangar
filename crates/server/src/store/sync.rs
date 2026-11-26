//! The store's sync: a clone, or a pull once cloned, run apart from the request that starts it, one at a time, its
//! outcome kept for the page to read again and notified.

use std::sync::Arc;

use hangar_api::{ErrorCode, StoreSync, SyncOperation, SyncState};
use hangar_core::StoreError;

use super::StoreState;
use super::command_log::CommandLog;
use crate::failure::Failure;
use crate::notifications::{Level, Message, Notification};

impl StoreState {
    /// The page a sync's notification leads to.
    const SYNC_HREF: &str = "/settings";

    /// The last sync since the server started, running or ended.
    pub(crate) fn last_sync(&self) -> Option<StoreSync> {
        self.sync.borrow().clone()
    }

    /// Starts a sync, and answers it running; while one runs, answers that one, and starts none.
    ///
    /// Detached: a clone or a pull is as long as the network makes it, and the request does not wait for it. Its end
    /// is kept, for `GET /store`, and notified.
    pub(crate) async fn start_sync(self: &Arc<Self>) -> StoreSync {
        let operation = if self.store.is_installed().await {
            SyncOperation::Update
        } else {
            SyncOperation::Install
        };
        let started = StoreSync {
            operation,
            state: SyncState::Running,
            started_at: Self::now(),
            finished_at: None,
            error: None,
        };
        let mut running = started.clone();

        // Checked and set under the channel's lock: of two requests at once, one starts the sync, the other gets it.
        let is_new = self.sync.send_if_modified(|latest| match latest {
            Some(sync) if sync.state == SyncState::Running => {
                running = sync.clone();
                false
            }
            _ => {
                *latest = Some(started.clone());
                true
            }
        });

        if is_new {
            let state = Arc::clone(self);

            tokio::spawn(async move { state.sync(operation).await });
        }

        running
    }

    /// Resolves once no sync runs.
    #[cfg(test)]
    pub(crate) async fn sync_ended(&self) -> Option<StoreSync> {
        let mut receiver = self.sync.subscribe();
        let ended = receiver
            .wait_for(|sync| {
                sync.as_ref()
                    .is_none_or(|sync| sync.state != SyncState::Running)
            })
            .await
            .expect("the state holds the sender");

        ended.clone()
    }

    /// Runs the sync `operation`, then records its outcome and notifies it.
    async fn sync(&self, operation: SyncOperation) {
        let outcome = self.store.install(CommandLog::lines("git", "store")).await;
        let (state, error, level, message) = match (&outcome, operation) {
            (Ok(()), SyncOperation::Install) => (
                SyncState::Succeeded,
                None,
                Level::Success,
                Message::StoreInstalled,
            ),
            (Ok(()), SyncOperation::Update) => (
                SyncState::Succeeded,
                None,
                Level::Success,
                Message::StoreUpdated,
            ),
            (Err(error), SyncOperation::Install) => (
                SyncState::Failed,
                Some(Self::describe(error, ErrorCode::CloneFailed)),
                Level::Error,
                Message::StoreInstallFailed,
            ),
            (Err(error), SyncOperation::Update) => (
                SyncState::Failed,
                Some(Self::describe(error, ErrorCode::PullFailed)),
                Level::Error,
                Message::StoreUpdateFailed,
            ),
        };

        match &outcome {
            Ok(()) => tracing::info!(?operation, "the store is synced"),
            Err(error) => {
                tracing::error!(?operation, error = %Failure::chain(error), "the store sync failed");
            }
        }

        let finished_at = Self::now();

        self.sync.send_modify(|latest| {
            if let Some(sync) = latest {
                sync.state = state;
                sync.finished_at = Some(finished_at);
                sync.error = error;
            }
        });
        self.notifier.notify(Notification {
            level,
            message,
            href: Self::SYNC_HREF,
        });
    }

    /// Why a sync failed, for the page: for an invalid `hangar.yml`, the field at fault, which the user is to fix;
    /// else `failed`, which sends them to the log. Never git's output, which may hold the URL's credentials.
    ///
    /// The page reads the code's English message: the sync's `error` gets its code with the problems' (quoll#140).
    fn describe(error: &StoreError, failed: ErrorCode) -> String {
        let code = match error {
            StoreError::Config { source, .. } => Failure::config(source),
            _ => failed,
        };

        code.message()
    }

    /// Now, in RFC 3339, to the millisecond.
    fn now() -> String {
        format!("{:.3}", jiff::Timestamp::now())
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use hangar_api::{SyncOperation, SyncState};
    use hangar_core::Runtime;

    use crate::Settings;
    use crate::notifications::{Level, Message};
    use crate::store::StoreState;

    /// A data directory, and a bare repository holding a store of one app, `alpha`, that `hangar.yml` lists.
    struct Fixture {
        dir: tempfile::TempDir,
        remote: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("a temporary directory");
            let work = dir.path().join("work");
            let remote = dir.path().join("remote.git");

            std::fs::create_dir_all(work.join("config")).expect("created");
            std::fs::create_dir_all(work.join("store/alpha")).expect("created");
            std::fs::write(
                work.join("config/hangar.yml"),
                "categories:\n  - { name: Apps, color: blue, stacks: [alpha] }\n",
            )
            .expect("written");
            std::fs::write(
                work.join("store/alpha/compose.yml"),
                "services:\n  alpha:\n    image: alpha:${ALPHA_TAG}\n",
            )
            .expect("written");
            Self::git(&work, &["init", "--quiet", "--initial-branch=main"]);
            Self::git(&work, &["add", "."]);
            Self::git(&work, &["commit", "--quiet", "--message", "the store"]);
            Self::git(
                dir.path(),
                &["clone", "--quiet", "--bare", "work", "remote.git"],
            );

            Self { dir, remote }
        }

        /// Runs git in `dir`, as a user of its own.
        fn git(dir: &Path, args: &[&str]) {
            let status = Command::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
                .args(args)
                .current_dir(dir)
                .status()
                .expect("git runs");

            assert!(status.success(), "git {args:?}");
        }

        fn data(&self) -> PathBuf {
            self.dir.path().join("data")
        }

        /// The store of the data directory, cloned from `url`, its commands run by `runtime`.
        fn state(&self, url: &str, runtime: Runtime) -> std::sync::Arc<StoreState> {
            let data = self.data().to_str().expect("UTF-8").to_owned();
            let url = url.to_owned();
            let settings = Settings::read(|name| match name {
                "HANGAR_DATA_DIR" => Some(data.clone()),
                "HANGAR_STORE_URL" => Some(url.clone()),
                "DOMAIN" => Some("example.com".to_owned()),
                "HANGAR_URL" => Some("https://hangar.example.com".to_owned()),
                "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
                _ => None,
            })
            .expect("the settings are valid");

            StoreState::new(&settings, runtime)
        }
    }

    #[tokio::test]
    async fn clones_the_store_then_pulls_it_each_notified() {
        let fixture = Fixture::new();
        let state = fixture.state(fixture.remote.to_str().expect("UTF-8"), Runtime::new());

        let started = state.start_sync().await;

        assert_eq!(started.operation, SyncOperation::Install);
        assert_eq!(started.state, SyncState::Running);

        let installed = state.sync_ended().await.expect("a sync");

        assert_eq!(installed.state, SyncState::Succeeded, "{installed:?}");
        assert!(installed.finished_at.is_some());
        assert!(
            fixture.data().join("app-installed/alpha").is_symlink(),
            "the apps of hangar.yml are linked"
        );
        assert!(
            std::fs::read_to_string(fixture.data().join(".env.global"))
                .expect("seeded")
                .contains("ALPHA_TAG="),
            "the variables of the installed apps are seeded"
        );

        assert_eq!(state.start_sync().await.operation, SyncOperation::Update);
        assert_eq!(
            state.sync_ended().await.expect("a sync").state,
            SyncState::Succeeded
        );
        assert_eq!(
            state
                .notifier
                .sent()
                .iter()
                .map(|sent| (sent.level, sent.message, sent.href))
                .collect::<Vec<_>>(),
            [
                (Level::Success, Message::StoreInstalled, "/settings"),
                (Level::Success, Message::StoreUpdated, "/settings")
            ]
        );
    }

    #[tokio::test]
    async fn a_failed_clone_is_kept_and_notified_without_git_s_output() {
        let fixture = Fixture::new();
        let missing = fixture.dir.path().join("secret-token@nowhere.git");
        let state = fixture.state(missing.to_str().expect("UTF-8"), Runtime::new());

        state.start_sync().await;

        let failed = state.sync_ended().await.expect("a sync");

        assert_eq!(failed.state, SyncState::Failed);
        assert_eq!(
            failed.error.as_deref(),
            Some("the store could not be cloned. See the server's log.")
        );
        assert_eq!(
            state.notifier.sent()[0].message,
            Message::StoreInstallFailed
        );
    }

    #[tokio::test]
    async fn a_second_sync_while_one_runs_answers_the_one_running() {
        let fixture = Fixture::new();
        let bin = fixture.dir.path().join("bin");
        let log = fixture.dir.path().join("git.log");
        let release = fixture.dir.path().join("release");

        // A git that logs its call, then waits for the test to let it end; its child's wait, not the test's.
        std::fs::create_dir(&bin).expect("created");
        std::fs::write(
            bin.join("git"),
            format!(
                "#!/bin/sh\necho \"$*\" >> {log}\nwhile [ ! -e {release} ]; do sleep 0.01; done\n",
                log = log.display(),
                release = release.display()
            ),
        )
        .expect("written");
        std::fs::set_permissions(
            bin.join("git"),
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .expect("made executable");

        let path = std::env::var("PATH").unwrap_or_default();
        let runtime = Runtime::new().envs([("PATH", format!("{}:{path}", bin.display()))]);
        let state = fixture.state("https://example.com/store.git", runtime);

        let first = state.start_sync().await;
        let second = state.start_sync().await;

        assert_eq!(second, first, "the sync running is answered");

        std::fs::write(&release, "").expect("written");

        let ended = state.sync_ended().await.expect("a sync");

        assert_eq!(ended.started_at, first.started_at);
        assert_eq!(
            std::fs::read_to_string(&log)
                .expect("git ran")
                .lines()
                .count(),
            1,
            "git ran once"
        );
        assert_eq!(state.notifier.sent().len(), 1, "one notification");
    }
}
