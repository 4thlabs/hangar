//! Hangar's server, on `hangar-core` and quoll: the routes of `hangar-api`'s contract, under `/api`, and the page, the
//! Vite build of `web/`, on one origin. Its [`Settings`] come from the environment, checked once at the start. Every
//! route but those of signing in and the health route takes a session, the signed cookie of a user of `hangar.yml`.
//! The store's routes run on the core's `Store`: its apps, its `hangar.yml`, `.env.global`, and its sync, which runs
//! apart from the request that starts it. The Docker routes read a cache of the daemon that its events keep fresh. The
//! notifications are one list for every user, kept in a JSON file of the data directory and pushed as they are filed,
//! and the compose commands of the Apps pages run in batches on their own, their output streamed and kept for a page
//! that comes back.

mod app;
mod auth;
mod compose;
mod docker;
mod failure;
mod health;
mod notifications;
mod settings;
mod store;
mod timestamp;
mod trailing_slash;

pub use app::{App, router, server};
pub use settings::{AuthSettings, OidcSettings, Secret, SettingError, Settings, SettingsError};
