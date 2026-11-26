//! A batch the server keeps: the core's, with its id, what the page asked for, and its report once recorded.

use std::sync::Arc;

use futures::{Stream, StreamExt, stream};
use hangar_api::{ComposeAction, ComposeBatch, ComposeEvent, ComposeReport};
use hangar_core::{BatchEvent, BatchReport, Secrets};
use quoll::Events;
use tokio::sync::watch;

use super::views::ComposeViews;
use crate::timestamp::Timestamp;

/// A batch of the core's, as the server keeps it for the pages that read it.
#[derive(Debug)]
pub(crate) struct KeptBatch {
    id: u64,
    action: ComposeAction,
    batch: hangar_core::ComposeBatch,
    started_at: String,
    /// What its output may echo that the page must not see.
    secrets: Secrets,
    /// Its report, once every app's end was told: what ends its output for the page.
    report: watch::Sender<Option<ComposeReport>>,
}

impl KeptBatch {
    /// The batch `id` of `action`, which the core runs as `batch`, started now, its output masked of `secrets`.
    pub(super) fn new(
        id: u64,
        action: ComposeAction,
        batch: hangar_core::ComposeBatch,
        secrets: Secrets,
    ) -> Arc<Self> {
        Arc::new(Self {
            id,
            action,
            batch,
            started_at: Timestamp::now(),
            secrets,
            report: watch::Sender::new(None),
        })
    }

    /// Its id.
    pub(super) fn id(&self) -> u64 {
        self.id
    }

    /// What the page asked for.
    pub(super) fn action(&self) -> ComposeAction {
        self.action
    }

    /// The apps, in the order the command runs on them.
    pub(super) fn apps(&self) -> Vec<String> {
        self.batch.apps().iter().map(ToString::to_string).collect()
    }

    /// The command line, as `docker compose up -d`.
    pub(super) fn command_line(&self) -> String {
        self.batch.command().to_string()
    }

    /// The core's output, from its start as far as it keeps it, to the end of the batch.
    pub(super) fn output(&self) -> impl Stream<Item = BatchEvent> + Send + 'static {
        self.batch.output()
    }

    /// Once the batch is over, how it ended on each app, as the core reports it.
    pub(super) async fn finished(&self) -> BatchReport {
        self.batch.finished().await
    }

    /// Records the report once the batch is over: the readers of its output get their `end`.
    pub(super) async fn record(&self) {
        let report = ComposeViews::report(&self.finished().await, &self.command_line());

        self.report.send_replace(Some(report));
    }

    /// Whether its report is recorded: it ended, and its apps were let go.
    pub(super) fn is_recorded(&self) -> bool {
        self.report.borrow().is_some()
    }

    /// Once recorded, the report.
    pub(super) async fn ended(&self) -> ComposeReport {
        let mut receiver = self.report.subscribe();
        let report = receiver
            .wait_for(Option::is_some)
            .await
            .expect("the batch holds the sender");

        report.clone().expect("waited for")
    }

    /// The events of its output: the batch first, then its output from its start, as far as it keeps it, then as it
    /// comes, its lines masked, and an `end` once its report is recorded.
    pub(crate) fn events(self: &Arc<Self>) -> Events<ComposeEvent> {
        let command = self.command_line();
        let masked = Arc::clone(self);
        let kept = Arc::clone(self);
        let first = stream::iter([ComposeEvent::Batch(self.view())]);
        let output = self
            .output()
            .map(move |event| ComposeViews::event(event, &command, &masked.secrets));
        let end = stream::once(async move { ComposeEvent::End(kept.ended().await) });

        Events::new(first.chain(output).chain(end))
    }

    /// The batch as the listing shows it.
    pub(crate) fn view(&self) -> ComposeBatch {
        ComposeBatch {
            id: self.id,
            action: self.action,
            command_line: self.command_line(),
            apps: self.apps(),
            started_at: self.started_at.clone(),
            report: self.report.borrow().clone(),
        }
    }
}
