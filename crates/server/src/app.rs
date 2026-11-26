//! The server's state, its router, and the layers it is served with.

use axum::middleware;
use hangar_api::{Api, ApiServices};
use quoll::server;

use crate::Settings;
use crate::trailing_slash::TrailingSlash;

/// The state the routes run on, which each group of the contract is implemented for.
#[derive(Debug, Clone, Default)]
pub struct App;

/// The routes of the contract, served by `app`.
pub fn router(app: App) -> axum::Router {
    Api::router(ApiServices { health: app })
}

/// The server, as `main` serves it and the tests too: an id and a span per request, answers compressed as the caller
/// accepts but streams, a path with a final `/` redirected to the one without, and the page when `settings` names
/// one. A client that stops reading is cut after quoll's default `send_timeout`.
pub fn server(settings: &Settings) -> server::Builder {
    let builder = server::builder()
        .with(server::request_id())
        .with(server::trace())
        .with(server::compression())
        .with(middleware::from_fn_with_state(
            TrailingSlash::new(settings.page.clone()),
            TrailingSlash::redirect,
        ));

    match &settings.page {
        Some(page) => builder.page(page),
        None => builder,
    }
}
