//! Hangar's server, on `hangar-core` and quoll: the routes of `hangar-api`'s contract, under `/api`, and the page, the
//! Vite build of `web/`, on one origin. Its [`Settings`] come from the environment, checked once at the start. Every
//! route but those of signing in and the health route takes a session, the signed cookie of a user of `hangar.yml`.
//! The store's routes run on the core's `Store`: its apps, its `hangar.yml`, `.env.global`, and its sync, which runs
//! apart from the request that starts it. The Docker routes read a cache of the daemon that its events keep fresh.

mod app;
mod auth;
mod docker;
mod failure;
mod health;
mod notifications;
mod settings;
mod store;
mod trailing_slash;

pub use app::{App, router, server};
pub use settings::{AuthSettings, OidcSettings, Secret, SettingError, Settings, SettingsError};
