//! The jobs of the apps' updates: the image check, which asks the registries what they serve for the images the
//! installed apps run and keeps their answers for the Docker pages, and the update of the apps, which checks again,
//! then pulls and recreates each app the registry has moved past, one at a time.

use std::collections::BTreeSet;
use std::sync::Arc;

use hangar_api::{ErrorCode, NotificationLevel, NotificationMessage};
use hangar_core::{
    CancellationToken, Compose, ComposeCommand, ComposeError, Config, Docker, Output, Runtime,
    Store, UpOptions,
};
use tokio::sync::mpsc;

use crate::Settings;
use crate::app_locks::AppLocks;
use crate::docker::DockerState;
use crate::failure::Failure;
use crate::notifications::{Notification, Notifier};

/// What the jobs of the updates run on: the client of the daemon, which they read afresh, the Docker state, which
/// keeps the registries' answers and is read again after each app, the store, compose, the apps the commands hold,
/// and the notifications.
#[derive(Debug)]
pub(crate) struct Updates {
    docker: Docker,
    docker_state: Arc<DockerState>,
    store: Store<Runtime>,
    compose: Compose<Runtime>,
    locks: Arc<AppLocks>,
    notifier: Notifier,
}

/// The apps an image check found the registry has moved past, and the `hangar.yml` it read, which orders them.
struct Checked {
    outdated: BTreeSet<String>,
    config: Config,
}

impl Updates {
    /// What the update of an app runs: its images pulled, and its containers recreated on them.
    const UPDATE: ComposeCommand = ComposeCommand::Up(UpOptions {
        pull: true,
        force_recreate: false,
    });

    /// How many lines of compose's output wait at most to be read, and dropped: the log has its failure.
    const OUTPUT_BACKLOG: usize = 64;

    /// The jobs of the updates of the server's settings, their commands run by `runtime` on the daemon of `docker`.
    pub(crate) fn new(
        settings: &Settings,
        runtime: Runtime,
        docker: Docker,
        docker_state: Arc<DockerState>,
        notifier: Notifier,
        locks: Arc<AppLocks>,
    ) -> Self {
        Self {
            docker,
            docker_state,
            store: Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime.clone(),
            ),
            compose: Compose::new(settings.data_dir.clone(), runtime),
            locks,
            notifier,
        }
    }

    /// The image check: asks the registries, keeps their answers for the Docker pages, and notifies
    /// `updatesAvailable` when apps have an update. Every four hours, it replaces its notification of before.
    ///
    /// # Errors
    ///
    /// The code of a `hangar.yml`, of the store's apps or of the daemon that cannot be read.
    pub(crate) async fn check_images(&self, cancel: &CancellationToken) -> Result<(), ErrorCode> {
        let Some(checked) = self.check(cancel).await? else {
            return Ok(());
        };

        if !checked.outdated.is_empty() {
            self.notifier.notify(Notification {
                level: NotificationLevel::Info,
                message: NotificationMessage::UpdatesAvailable {
                    count: Self::count(checked.outdated.len()),
                },
                href: Some("/apps".to_owned()),
                dedupe_key: Some("image-updates".to_owned()),
            });
        }

        Ok(())
    }

    /// The update of the apps: checks the images again, as the last check may be hours old, then runs `docker compose
    /// up -d --pull always` on each app the registry has moved past, one at a time in the order of `hangar.yml`,
    /// carrying on after one that fails, and notifies `autoUpdate` once for them all. The apps are held until it ends,
    /// as a compose batch holds its own; once canceled, it ends the app it updates and starts no other.
    ///
    /// # Errors
    ///
    /// The errors of [`check_images`](Self::check_images), and `compose.app_busy` when another command holds one of
    /// the apps, or a sync of the store runs: no app is updated then.
    pub(crate) async fn update_apps(&self, cancel: &CancellationToken) -> Result<(), ErrorCode> {
        let Some(checked) = self.check(cancel).await? else {
            return Ok(());
        };

        if checked.outdated.is_empty() {
            tracing::info!("no app to update: the registries serve what they run");
            return Ok(());
        }

        let apps = Self::in_order(&checked.outdated, &checked.config);
        let claim = self.locks.claim_batch(apps.iter().map(String::as_str))?;
        let mut updated = Vec::new();
        let mut failed = Vec::new();

        for app in apps {
            if cancel.is_cancelled() {
                break;
            }

            match self.update(&app).await {
                Ok(()) => updated.push(app),
                Err(error) => {
                    tracing::error!(%app, error = %Failure::chain(&error), "could not update an app");
                    failed.push(app);
                }
            }

            // The update badge clears once the cache holds the containers recreated.
            self.docker_state.settle().await;
        }

        drop(claim);
        tracing::info!(
            updated = %updated.join(", "),
            failed = %failed.join(", "),
            "the apps the registries moved past are updated"
        );

        // One notification for them all: this runs while nobody watches.
        if !updated.is_empty() || !failed.is_empty() {
            let level = if failed.is_empty() {
                NotificationLevel::Success
            } else {
                NotificationLevel::Error
            };

            self.notifier.notify(Notification {
                level,
                message: NotificationMessage::AutoUpdate {
                    updated: Self::count(updated.len()),
                    failed: failed.join(", "),
                },
                href: Some("/apps".to_owned()),
                dedupe_key: Some("auto-update".to_owned()),
            });
        }

        Ok(())
    }

    /// Asks the registries what they serve for the images the installed apps run, as `hangar.yml` spaces the calls,
    /// keeps their answers in the Docker state, and gives the apps they moved past; `None` once canceled.
    async fn check(&self, cancel: &CancellationToken) -> Result<Option<Checked>, ErrorCode> {
        let config = self
            .store
            .config()
            .await
            .map_err(|error| Failure::store_code(ErrorCode::ConfigUnreadable, &error))?;
        let installed: Vec<String> = self
            .store
            .apps_with(&config)
            .await
            .map_err(|error| Failure::store_code(ErrorCode::AppsUnreadable, &error))?
            .into_iter()
            .filter(|app| app.installed)
            .map(|app| app.id)
            .collect();
        // Read afresh, not from the cache: the update of the apps recreates what they say.
        let (containers, digests) =
            tokio::try_join!(self.docker.containers(), self.docker.image_digests())
                .map_err(|error| Failure::logged_code(ErrorCode::DockerUnavailable, &error))?;
        let running = containers.running_images(&installed, &digests);
        let asked = self
            .docker
            .registry_digests(&running, config.registry_throttling);
        let registry = tokio::select! {
            biased;
            () = cancel.cancelled() => return Ok(None),
            registry = asked => registry,
        };
        let outdated = registry.outdated(&running);

        tracing::info!(
            references = registry.len(),
            outdated = %outdated.iter().cloned().collect::<Vec<_>>().join(", "),
            "the images are checked for an update"
        );
        self.docker_state.keep_registry_digests(registry);

        Ok(Some(Checked { outdated, config }))
    }

    /// `apps` in the order `hangar.yml` lists them in its categories, those it does not list after, by name.
    fn in_order(apps: &BTreeSet<String>, config: &Config) -> Vec<String> {
        let stacks = config.stacks();
        let mut ordered: Vec<String> = apps.iter().cloned().collect();

        ordered.sort_by_key(|app| {
            stacks
                .iter()
                .position(|stack| stack == app)
                .unwrap_or(usize::MAX)
        });
        ordered
    }

    /// Pulls the images of `app` and recreates its containers on them; compose's output is dropped, its stderr's end
    /// in the error of a failure.
    async fn update(&self, app: &str) -> Result<(), ComposeError> {
        let (lines, mut output) = mpsc::channel(Self::OUTPUT_BACKLOG);
        let drained = tokio::spawn(async move { while output.recv().await.is_some() {} });
        let updated = self
            .compose
            .run(app, Self::UPDATE, Output::Lines(lines))
            .await;

        // The sender went with the run: the drain has ended, or ends now.
        let _ = drained.await;

        tracing::info!(app, "an app is updated from its registry");
        updated
    }

    /// `count` as the params of a notification carry it.
    fn count(count: usize) -> u64 {
        u64::try_from(count).unwrap_or(u64::MAX)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::Arc;

    use axum::Json;
    use axum::extract::Path;
    use axum::routing::get;
    use hangar_api::{NotificationLevel, NotificationMessage};
    use hangar_core::{CancellationToken, Docker, Runtime};
    use serde_json::{Value, json};

    use super::Updates;
    use crate::Settings;
    use crate::docker::{DockerChanges, DockerState};
    use crate::notifications::Notifier;

    /// The fake `docker`: it logs its arguments, and fails on the app `HANGAR_TEST_FAIL` names.
    const FAKE_DOCKER: &str = r#"#!/bin/sh
echo "$*" >> "$HANGAR_TEST_LOG"
previous=""
for arg in "$@"; do
  if [ "$previous" = "-p" ] && [ "$arg" = "${HANGAR_TEST_FAIL:-none}" ]; then echo "no such image" >&2; exit 1; fi
  previous="$arg"
done
"#;

    /// The installed apps, the image each runs, the digest of the image it runs, and the digest its registry serves:
    /// `gamma` and `alpha` run an image the registry has moved past, `beta` the one it serves.
    const APPS: [(&str, &str, &str, &str); 3] = [
        (
            "alpha",
            "nginx:alpine",
            "sha256:old-nginx",
            "sha256:new-nginx",
        ),
        ("beta", "traefik:3", "sha256:traefik", "sha256:traefik"),
        ("gamma", "redis:7", "sha256:old-redis", "sha256:new-redis"),
    ];

    /// A daemon on port 0 that runs a container of each of [`APPS`], and answers for their registries.
    async fn daemon() -> Docker {
        let router = axum::Router::new()
            .route("/v1.44/containers/json", get(containers))
            .route(
                "/v1.44/containers/{id}/json",
                get(|| async { Json(json!({})) }),
            )
            .route("/v1.44/images/json", get(images))
            .route("/v1.44/distribution/{reference}/json", get(distribution));
        let url = quoll::test::spawn(router).await;

        Docker::with_host(&url.replace("http://", "tcp://")).expect("a client")
    }

    async fn containers() -> Json<Vec<Value>> {
        Json(
            APPS.iter()
                .enumerate()
                .map(|(index, (app, image, _, _))| {
                    json!({
                        "Id": format!("{index}").repeat(64),
                        "Names": [format!("/{app}-web-1")],
                        "Image": image,
                        "ImageID": format!("sha256:{app}"),
                        "State": "running",
                        "Status": "Up 2 hours",
                        "Labels": {
                            "com.docker.compose.project": app,
                            "com.docker.compose.service": "web",
                            "com.docker.compose.container-number": "1",
                        },
                    })
                })
                .collect(),
        )
    }

    async fn images() -> Json<Vec<Value>> {
        Json(
            APPS.iter()
                .map(|(app, image, runs, _)| {
                    let name = image.split(':').next().unwrap_or_default();

                    json!({ "Id": format!("sha256:{app}"), "RepoDigests": [format!("{name}@{runs}")] })
                })
                .collect(),
        )
    }

    async fn distribution(Path(reference): Path<String>) -> Json<Value> {
        let served = APPS
            .iter()
            .find(|(_, image, _, _)| *image == reference)
            .map_or("sha256:unknown", |(_, _, _, served)| *served);

        Json(json!({ "Descriptor": { "digest": served } }))
    }

    /// A data directory where [`APPS`] are installed, `hangar.yml` listing `gamma` first, a fake `docker` that fails
    /// on `fail`, and the log of its calls.
    struct Fixture {
        _dir: tempfile::TempDir,
        log: PathBuf,
        updates: Updates,
        notifier: Notifier,
    }

    impl Fixture {
        async fn new(fail: Option<&str>) -> Self {
            let dir = tempfile::tempdir().expect("a temporary directory");
            let data = dir.path().join("data");
            let store = data.join("app-store");
            let bin = dir.path().join("bin");
            let log = dir.path().join("docker.log");

            fs::create_dir_all(store.join(".git")).expect("created");
            fs::create_dir_all(store.join("config")).expect("created");
            fs::create_dir_all(data.join("app-installed")).expect("created");

            for (app, image, _, _) in APPS {
                let folder = store.join("store").join(app);

                fs::create_dir_all(&folder).expect("created");
                fs::write(
                    folder.join("compose.yml"),
                    format!("services:\n  web:\n    image: {image}\n"),
                )
                .expect("written");
                std::os::unix::fs::symlink(&folder, data.join("app-installed").join(app))
                    .expect("linked");
            }

            fs::write(
                store.join("config/hangar.yml"),
                "categories:\n  - { name: Apps, color: blue, stacks: [gamma, beta, alpha] }\nregistryThrottling: 0\n",
            )
            .expect("written");
            fs::create_dir_all(&bin).expect("created");
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
            let path = std::env::var("PATH").unwrap_or_default();
            let runtime = Runtime::new().envs([
                ("PATH", format!("{}:{path}", bin.display())),
                ("HANGAR_TEST_LOG", log.display().to_string()),
                ("HANGAR_TEST_FAIL", fail.unwrap_or("none").to_owned()),
            ]);
            let docker = daemon().await;
            let docker_state = DockerState::new(
                &settings,
                runtime.clone(),
                docker.clone(),
                DockerChanges::new(),
            );
            let notifier = Notifier::load(&settings.data_dir).await;
            let updates = Updates::new(
                &settings,
                runtime,
                docker,
                docker_state,
                notifier.clone(),
                Arc::default(),
            );

            Self {
                _dir: dir,
                log,
                updates,
                notifier,
            }
        }

        /// The apps the fake `docker` ran `compose ... up -d --pull always` on, in order.
        fn updated(&self) -> Vec<String> {
            let log = fs::read_to_string(&self.log).unwrap_or_default();

            log.lines()
                .filter(|line| {
                    line.starts_with("compose ") && line.ends_with(" up -d --pull always")
                })
                .map(|line| {
                    let after = line.split(" -p ").nth(1).expect("the project");

                    after.split(' ').next().expect("its name").to_owned()
                })
                .collect()
        }

        /// The notifications filed, the newest first: their level, message, link and dedupe key.
        fn notified(
            &self,
        ) -> Vec<(
            NotificationLevel,
            NotificationMessage,
            Option<String>,
            Option<String>,
        )> {
            self.notifier
                .recent()
                .notifications
                .into_iter()
                .map(|filed| (filed.level, filed.message, filed.href, filed.dedupe_key))
                .collect()
        }
    }

    #[tokio::test]
    async fn checks_the_images_keeps_the_answers_and_notifies_the_apps_with_an_update() {
        let fixture = Fixture::new(None).await;

        fixture
            .updates
            .check_images(&CancellationToken::new())
            .await
            .expect("checked");

        let containers = fixture
            .updates
            .docker
            .containers()
            .await
            .expect("the containers");
        let outdated = fixture
            .updates
            .docker_state
            .outdated(&containers, ["alpha", "beta", "gamma"])
            .await;

        assert_eq!(outdated.into_iter().collect::<Vec<_>>(), ["alpha", "gamma"]);
        assert!(fixture.updated().is_empty(), "a check updates nothing");
        assert_eq!(
            fixture.notified(),
            [(
                NotificationLevel::Info,
                NotificationMessage::UpdatesAvailable { count: 2 },
                Some("/apps".to_owned()),
                Some("image-updates".to_owned()),
            )]
        );
    }

    #[tokio::test]
    async fn updates_each_app_the_registry_moved_past_in_turn_in_the_order_of_hangar_yml() {
        let fixture = Fixture::new(None).await;

        fixture
            .updates
            .update_apps(&CancellationToken::new())
            .await
            .expect("updated");

        assert_eq!(fixture.updated(), ["gamma", "alpha"]);
        assert_eq!(
            fixture.notified(),
            [(
                NotificationLevel::Success,
                NotificationMessage::AutoUpdate {
                    updated: 2,
                    failed: String::new()
                },
                Some("/apps".to_owned()),
                Some("auto-update".to_owned()),
            )]
        );
    }

    #[tokio::test]
    async fn carries_on_after_an_app_that_fails_and_names_it() {
        let fixture = Fixture::new(Some("gamma")).await;

        fixture
            .updates
            .update_apps(&CancellationToken::new())
            .await
            .expect("updated");

        let (level, message, _, _) = fixture.notified().remove(0);

        assert_eq!(fixture.updated(), ["gamma", "alpha"]);
        assert_eq!(level, NotificationLevel::Error);
        assert_eq!(
            message,
            NotificationMessage::AutoUpdate {
                updated: 1,
                failed: "gamma".to_owned()
            }
        );
    }

    #[tokio::test]
    async fn updates_no_app_once_canceled() {
        let fixture = Fixture::new(None).await;
        let cancel = CancellationToken::new();

        cancel.cancel();
        fixture.updates.update_apps(&cancel).await.expect("ended");

        assert!(fixture.updated().is_empty());
        assert!(fixture.notified().is_empty());
    }

    #[tokio::test]
    async fn updates_no_app_another_command_holds() {
        let fixture = Fixture::new(None).await;
        let _held = fixture.updates.locks.claim_change("alpha").expect("held");

        let refused = fixture.updates.update_apps(&CancellationToken::new()).await;

        assert_eq!(
            refused,
            Err(hangar_api::ErrorCode::AppBusy {
                app: "alpha".to_owned()
            })
        );
        assert!(fixture.updated().is_empty());
    }
}
