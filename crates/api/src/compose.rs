//! Compose: the commands the Apps pages run on a batch of installed apps, `up`, `restart` and `down`, each batch
//! running on its own on the server, its output streamed as it comes, and read again from its start by a page that
//! comes back.

use quoll::Events;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ErrorDetail;

/// A compose command the Apps pages run: `up -d` with its options, `restart` or `down`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ComposeAction {
    /// `up -d`: creates and starts what is missing, with the options it is given.
    Up {
        /// `--pull always`: pulls every image first, which updates the app.
        pull: bool,
        /// `--force-recreate`: recreates the containers even when nothing changed.
        force_recreate: bool,
    },
    /// `restart`: restarts the app's containers.
    Restart,
    /// `down`: stops and removes the app's containers and networks; the app stays installed.
    Down,
}

/// A batch to start: a command, and the apps it runs on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ComposeRequest {
    /// The command.
    pub action: ComposeAction,
    /// The apps, by id, in any order: the batch runs them in the order of `hangar.yml`, `down` in reverse, each once.
    pub apps: Vec<String>,
}

/// A batch the server runs, or ran a short while ago.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComposeBatch {
    /// Its id, which reads its output again.
    pub id: u64,
    /// The command.
    pub action: ComposeAction,
    /// The command line, as `docker compose up -d --pull always`, without the project and its files.
    pub command_line: String,
    /// The apps, in the order the command runs on them.
    pub apps: Vec<String>,
    /// When it started, in RFC 3339.
    pub started_at: String,
    /// How it ended on each app; `None` while it runs.
    pub report: Option<ComposeReport>,
}

/// How the command ended on an app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComposeStatus {
    /// It succeeded.
    Succeeded,
    /// It failed: its output says why.
    Failed,
    /// It did not run, or did not end: the batch stopped short, and the server's log says why.
    NotRun,
}

/// How the command ended on one app of a batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ComposeOutcome {
    /// The app.
    pub app: String,
    /// How it ended.
    pub status: ComposeStatus,
    /// Why it failed, as a code and its params beside its English message; `None` unless it failed.
    pub error: Option<ErrorDetail>,
}

/// How a batch ended: one outcome per app, in the order the command ran on them.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ComposeReport {
    /// The outcomes.
    pub apps: Vec<ComposeOutcome>,
}

/// An event of a batch's output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ComposeEvent {
    /// The command starts on an app: the head of its lines.
    Started {
        /// The app.
        app: String,
    },
    /// A line `docker compose` printed on an app, stdout and stderr together, without its line break.
    Line {
        /// The app.
        app: String,
        /// The line.
        line: String,
    },
    /// The command ended on an app, or the batch ended without running it there.
    Finished(ComposeOutcome),
    /// The events this reader missed, which the batch no longer keeps: it keeps the last MiB of its output.
    Skipped {
        /// How many.
        events: u64,
    },
    /// The last event, once every app was read again from the daemon and notified: how the batch ended on each.
    End(ComposeReport),
}

quoll::group! {
    /// The compose commands of the installed apps, run in batches on the server, whoever reads their output.
    #[auth(crate::Session)]
    pub group Compose {
        /// Starts a batch, once every app is checked: a 400 for a name compose does not take or no app at all, a 404
        /// for an app that is not installed, and none runs. Then its output, from its start: a `started` per app, its
        /// lines, its `finished`, and an `end` with the report. The batch goes on once the stream is closed; each app's
        /// end is notified.
        POST "/docker/compose" => run(request: &ComposeRequest) -> Events<ComposeEvent>;

        /// The batches that run, and those that ended in the last five minutes, by id.
        GET "/docker/compose" => batches() -> Vec<ComposeBatch>;

        /// The output of a batch from its start, as far as it keeps it, then as it comes, to its `end`. A 404 for a
        /// batch that is not listed.
        GET "/docker/compose/{id}" => output(id: u64) -> Events<ComposeEvent>;
    }
}
