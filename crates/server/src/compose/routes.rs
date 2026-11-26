//! The routes of the group `Compose`: a batch started and its output, the batches kept, and the output of one again.

use hangar_api::{ComposeBatch, ComposeEvent, ComposeRequest, ComposeServer};
use quoll::{Events, Response, Result};

use crate::App;
use crate::auth::SignedIn;

impl ComposeServer for App {
    async fn run(
        &self,
        _: &SignedIn,
        request: ComposeRequest,
    ) -> Result<Response<Events<ComposeEvent>>> {
        let kept = self.compose.start(request.action, &request.apps).await?;

        Ok(Response::new(kept.events()))
    }

    async fn batches(&self, _: &SignedIn) -> Result<Response<Vec<ComposeBatch>>> {
        let batches = self.compose.kept().iter().map(|kept| kept.view()).collect();

        Ok(Response::new(batches))
    }

    async fn output(&self, _: &SignedIn, id: u64) -> Result<Response<Events<ComposeEvent>>> {
        Ok(Response::new(self.compose.batch(id)?.events()))
    }
}
