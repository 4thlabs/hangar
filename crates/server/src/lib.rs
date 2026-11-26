//! Hangar's server, on `hangar-core` and quoll: the routes of `hangar-api`'s contract, under `/api`, and the page, the
//! Vite build of `web/`, on one origin. Its [`Settings`] come from the environment, checked once at the start. Every
//! route but those of signing in and the health route takes a session, the signed cookie of a user of `hangar.yml`.

mod app;
mod auth;
mod health;
mod settings;
mod trailing_slash;

pub use app::{App, router, server};
pub use settings::{AuthSettings, OidcSettings, Secret, SettingError, Settings, SettingsError};
