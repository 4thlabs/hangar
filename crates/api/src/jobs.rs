//! The jobs: what the server runs on its own schedules, as the check of the images for an update, or when a user asks
//! for it again. Each job waits its turn in its queue, which runs one at a time; the server keeps the last 50 runs in
//! memory, for the settings.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ErrorDetail;

/// A job the server runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Job {
    /// Asks the registries what they serve for the images the installed apps run, which tells the apps that have an
    /// update: every four hours, at the 17th minute, and once the server starts.
    ImageCheck,
    /// Checks the images again, then updates each app the registry has moved past, `docker compose up -d --pull
    /// always`, one at a time: every night at 04:47.
    AutoUpdate,
}

/// The queue a job waits its turn in: each runs one job at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobQueue {
    /// The image check and the update of the apps.
    Default,
}

/// Where a run is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    /// It waits its turn in its queue.
    Waiting,
    /// It runs.
    Running,
    /// It ended as it should.
    Completed,
    /// It failed: its error says why.
    Failed,
    /// A user canceled it.
    Canceled,
}

/// A run of a job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    /// Its id, from 1, greater than that of every run before it since the server started.
    pub id: u64,
    /// The job it runs.
    pub job: Job,
    /// The queue it waits in.
    pub queue: JobQueue,
    /// Where it is.
    pub state: JobState,
    /// When it was asked for, on its schedule or by a user, in RFC 3339.
    pub created_at: String,
    /// When it started, in RFC 3339; `None` while it waits, and for one canceled before.
    pub started_at: Option<String>,
    /// When it ended, in RFC 3339; `None` while it waits or runs.
    pub ended_at: Option<String>,
    /// Why it failed; `None` for one that did not.
    pub error: Option<ErrorDetail>,
}

quoll::group! {
    /// The jobs of the server, run on their schedules or when asked: the last 50 runs, kept in memory.
    #[auth(crate::Session)]
    pub group Jobs {
        /// The runs kept, the newest first: those that wait or run, and the last that ended, 50 in all.
        GET "/jobs" => list() -> Vec<JobRun>;

        /// Runs the job of the run `id` again, in a new run that waits its turn in its queue: the run of that job that
        /// waits or runs already, when there is one. A 404 for a run that is not kept.
        POST "/jobs/{id}/run" => run(id: u64) -> JobRun;

        /// Cancels the run `id`: one that waits leaves its queue, one that runs stops at its next step, the end of the
        /// app it updates for the update of the apps. A 404 for a run that is not kept, a 409 for one that ended.
        POST "/jobs/{id}/cancel" => cancel(id: u64) -> JobRun;
    }
}
