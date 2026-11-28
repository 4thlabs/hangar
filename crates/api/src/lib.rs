//! The contract of Hangar's server, written with quoll: the routes of [`Api`], under `/api`, in one group per area,
//! and the types they carry. The server implements it, a Rust client calls it, and the page calls it through the
//! TypeScript that orval writes from its OpenAPI document, which the binary `openapi` prints.

mod api;
mod auth;
mod backups;
mod compose;
mod config;
mod docker;
mod editor;
mod env;
mod error;
mod health;
mod jobs;
mod notifications;
mod services;
mod store;
mod widgets;

pub use api::*;
pub use auth::*;
pub use backups::*;
pub use compose::*;
pub use config::*;
pub use docker::*;
pub use editor::*;
pub use env::*;
pub use error::*;
pub use health::*;
pub use jobs::*;
pub use notifications::*;
pub use services::*;
pub use store::*;
pub use widgets::*;
