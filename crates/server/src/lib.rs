//! Hangar's server, on `hangar-core` and quoll: the routes of `hangar-api`'s contract, under `/api`, and the page, the
//! Vite build of `web/`, on one origin. Its [`Settings`] come from the environment, checked once at the start.

mod app;
mod health;
mod settings;
mod trailing_slash;

pub use app::{App, router, server};
pub use settings::{Secret, SettingError, Settings, SettingsError};
