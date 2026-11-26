//! The routes of the group `Jobs`: the runs kept, and a job asked for again or canceled.

use hangar_api::{JobRun, JobsServer};
use quoll::{Response, Result};

use crate::App;
use crate::auth::SignedIn;

impl JobsServer for App {
    async fn list(&self, _: &SignedIn) -> Result<Response<Vec<JobRun>>> {
        Ok(Response::new(self.jobs.list()))
    }

    async fn run(&self, _: &SignedIn, id: u64) -> Result<Response<JobRun>> {
        Ok(Response::new(self.jobs.run_again(id)?))
    }

    async fn cancel(&self, _: &SignedIn, id: u64) -> Result<Response<JobRun>> {
        Ok(Response::new(self.jobs.cancel(id)?))
    }
}
