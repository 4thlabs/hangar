//! The contract of Hangar's server, written with quoll: the routes of [`Api`], under `/api`, in one group per area,
//! and the types they carry. The server implements it, a Rust client calls it, and the page calls it through the
//! TypeScript that orval writes from its OpenAPI document, which the binary `openapi` prints.

mod api;
mod auth;
mod config;
mod docker;
mod editor;
mod env;
mod error;
mod health;
mod store;

pub use api::*;
pub use auth::*;
pub use config::*;
pub use docker::*;
pub use editor::*;
pub use env::*;
pub use error::*;
pub use health::*;
pub use store::*;
