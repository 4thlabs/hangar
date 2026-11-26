//! The server's state, its router, and the layers it is served with.

use std::sync::Arc;

use axum::middleware;
use hangar_api::{Api, ApiServices};
use quoll::server;

use hangar_core::{Docker, Runtime};

use crate::Settings;
use crate::app_locks::AppLocks;
use crate::auth::{Auth, AuthBodyLimit, OriginCheck};
use crate::compose::ComposeState;
use crate::docker::{DockerChanges, DockerState};
use crate::notifications::Notifier;
use crate::store::StoreState;
use crate::trailing_slash::TrailingSlash;

/// The state the routes run on, which each group of the contract is implemented for; its clones share it.
#[derive(Debug, Clone)]
pub struct App {
    pub(crate) auth: Arc<Auth>,
    pub(crate) store: Arc<StoreState>,
    pub(crate) docker: Arc<DockerState>,
    pub(crate) notifier: Notifier,
    pub(crate) compose: Arc<ComposeState>,
}

impl App {
    /// The state of a server of `settings` on the daemon of `docker`, its commands, `git` and `docker compose`, run as
    /// children of this process.
    pub async fn new(settings: &Settings, docker: Docker) -> Self {
        Self::with_runtime(settings, Runtime::new(), docker).await
    }

    /// The state of a server of `settings` on the daemon of `docker`, its commands run by `runtime`: with the variables
    /// it sets, as a `PATH` that finds another `docker`, or the cancellation that stops them. The notifications are read
    /// from their file of the data directory.
    pub async fn with_runtime(settings: &Settings, runtime: Runtime, docker: Docker) -> Self {
        let docker_changes = DockerChanges::new();
        let notifier = Notifier::load(&settings.data_dir).await;
        let locks = Arc::new(AppLocks::default());
        let docker = DockerState::new(settings, runtime.clone(), docker, docker_changes.clone());

        Self {
            auth: Arc::new(Auth::new(settings)),
            store: StoreState::new(
                settings,
                runtime.clone(),
                docker_changes,
                notifier.clone(),
                Arc::clone(&locks),
            ),
            compose: ComposeState::new(
                settings,
                runtime,
                Arc::clone(&docker),
                notifier.clone(),
                locks,
            ),
            docker,
            notifier,
        }
    }

    /// Readies the state as the server starts: the password check, the log of who may sign in, and how, and the
    /// daemon's events followed, which keep what the server reads of Docker fresh.
    pub async fn start(&self) {
        self.docker.follow();
        self.auth.start().await;
    }

    /// Ends the state once the server has stopped serving: what was changed of the notifications and is not saved yet
    /// is saved, the saves running waited for.
    pub async fn stop(&self) {
        self.notifier.flush().await;
    }
}

/// The routes of the contract, served by `app`.
pub fn router(app: App) -> axum::Router {
    Api::router(ApiServices {
        health: app.clone(),
        auth: app.clone(),
        store: app.clone(),
        editor: app.clone(),
        config: app.clone(),
        env: app.clone(),
        docker: app.clone(),
        notifications: app.clone(),
        compose: app,
    })
}

/// The server, as `main` serves it and the tests too: an id and a span per request, answers compressed as the caller
/// accepts but streams, a request that changes something refused from another origin than `HANGAR_URL`'s, the bodies
/// of signing in bounded to 16 KiB, a path with a final `/` redirected to the one without, and the page when
/// `settings` names one. A client that stops
/// reading is cut after quoll's default `send_timeout`.
pub fn server(settings: &Settings) -> server::Builder {
    let builder = server::builder()
        .with(server::request_id())
        .with(server::trace())
        .with(server::compression())
        .with(middleware::from_fn_with_state(
            OriginCheck::new(&settings.auth.url),
            OriginCheck::check,
        ))
        .with(middleware::from_fn(AuthBodyLimit::limit))
        .with(middleware::from_fn_with_state(
            TrailingSlash::new(settings.page.clone()),
            TrailingSlash::redirect,
        ));

    match &settings.page {
        Some(page) => builder.page(page),
        None => builder,
    }
}
