//! The health route, which the image's healthcheck calls.

use hangar_api::{HealthServer, ServerHealth};
use quoll::{Response, Result};

use crate::App;

impl HealthServer for App {
    async fn check(&self) -> Result<Response<ServerHealth>> {
        Ok(Response::new(ServerHealth {
            version: hangar_core::VERSION.to_owned(),
        }))
    }
}
