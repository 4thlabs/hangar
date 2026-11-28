//! Hangar's server, on `hangar-core` and quoll: the routes of `hangar-api`'s contract, under `/api`, and the page, the
//! Vite build of `web/`, on one origin. Its [`Settings`] come from the environment, checked once at the start. Every
//! route but those of signing in and the health route takes a session, the signed cookie of a user of `hangar.yml`.
//! The store's routes run on the core's `Store`: its apps, its `hangar.yml`, `.env.global`, and its sync, which runs
//! apart from the request that starts it. The Docker routes read a cache of the daemon that its events keep fresh. The
//! notifications are one list for every user, kept in a JSON file of the data directory and pushed as they are filed,
//! and the compose commands of the Apps pages run in batches on their own, their output streamed and kept for a page
//! that comes back. The jobs run on their crons in the server's process, one at a time per queue: the image check, which
//! tells the Docker pages the apps that have an update, and the update of those apps, every night.
//! The dashboard's widgets each read their service through a quoll contract of its own, kept per
//! placement and loaded only when a page asks.

mod app;
mod app_locks;
mod auth;
mod backups;
mod compose;
mod docker;
mod failure;
mod health;
mod jobs;
mod notifications;
mod settings;
mod store;
mod timestamp;
mod trailing_slash;
mod widgets;

pub use app::{App, router, server};
pub use settings::{AuthSettings, OidcSettings, Secret, SettingError, Settings, SettingsError};
