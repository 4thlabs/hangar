//! The commands, on the core: installing the store, compose on its apps, and listing the compose projects.

use std::pin::pin;

use futures::StreamExt;
use hangar_core::{
    AppStatus, BatchEvent, Command, CommandRunner, Compose, ComposeBatch, ComposeCommand, Config,
    OnFailure, Output, RunError, Runtime, Store,
};
use tokio::io::AsyncWriteExt;

use crate::environment::Environment;
use crate::failure::Failure;
use crate::request::ComposeRequest;
use crate::terminal::Terminal;

/// The commands of `hangar store`, run by one runtime, which Ctrl-C interrupts.
#[derive(Debug)]
pub(crate) struct Hangar {
    runtime: Runtime,
    environment: Environment,
    terminal: Terminal,
}

impl Hangar {
    /// The commands, their children run by `runtime`, their variables read from `environment`; a child that inherits
    /// the terminal is handed `terminal`.
    pub(crate) fn new(runtime: Runtime, environment: Environment, terminal: Terminal) -> Self {
        Self {
            runtime,
            environment,
            terminal,
        }
    }

    /// `store install`: clones the store, or pulls it, with git's output on the terminal, then links its apps and
    /// seeds `.env.global`.
    pub(crate) async fn install(&self) -> Result<(), Failure> {
        let store = Store::new(
            self.environment.store_url()?,
            self.environment.data_dir()?,
            self.runtime.clone(),
        );

        Ok(store.install(Output::Inherit).await?)
    }

    /// Runs a compose command on the apps of its target.
    ///
    /// A command passed through, on one app, inherits the terminal, as compose run by hand: its colours, its TTY, its
    /// stdin and its Ctrl-C, for `logs -f`, `exec` or an `up` that attaches. Any other runs as one batch that stops at
    /// the first failure, as the Node CLI does, its output printed as it comes, and says when docker has no compose.
    pub(crate) async fn compose(&self, request: ComposeRequest) -> Result<(), Failure> {
        let data_dir = self.environment.data_dir()?;
        // Only `hangar.yml` is read: the URL serves an install alone.
        let config = Store::new(String::new(), data_dir.clone(), self.runtime.clone())
            .config()
            .await?;
        let apps = request.target.apps(&config);
        let compose = Compose::new(data_dir, self.runtime.clone());

        if let ComposeCommand::Args(_) = request.command
            && let [app] = apps.as_slice()
        {
            let run = compose.run(app, request.command, Output::Inherit);

            return Ok(self.terminal.hand_over(run).await?);
        }

        let outcome = Self::run_batch(&compose, request.command, &apps, &config).await;

        self.explain(outcome).await
    }

    /// `store ls [args...]`: `docker compose ls`, on the terminal.
    pub(crate) async fn list(&self, args: &[String]) -> Result<(), Failure> {
        let list = Command::new("docker").args(["compose", "ls"]).args(args);

        Ok(self.runtime.run(&list, Output::Inherit).await?)
    }

    /// Runs `command` on `apps` as one batch that stops at the first failure, its output printed as it comes.
    async fn run_batch(
        compose: &Compose<Runtime>,
        command: ComposeCommand,
        apps: &[String],
        config: &Config,
    ) -> Result<(), Failure> {
        let batch = compose
            .batch(command, apps, config, OnFailure::Stop)
            .await?;

        Self::print(&batch).await;

        Self::outcome(&batch).await
    }

    /// The outcome of a batch, its failure said as a missing compose when docker exited with an error and has no
    /// `compose` command: docker's own complaint is lost in the batch's output. A command on the terminal, as
    /// `store ls`, has shown it already. Docker is asked only once the batch failed, so that one that succeeds runs
    /// nothing more.
    async fn explain(&self, outcome: Result<(), Failure>) -> Result<(), Failure> {
        let Err(failure) = outcome else {
            return Ok(());
        };

        if !failure.has_exited_with_error() {
            return Err(failure);
        }

        let version = Command::new("docker").args(["compose", "version"]);

        match self.runtime.capture(&version).await {
            Err(RunError::Failed { stderr, .. }) if Self::is_unknown_command(&stderr) => {
                Err(Failure::NoCompose(Box::new(failure)))
            }
            _ => Err(failure),
        }
    }

    /// Whether docker's stderr says it has no such command, as `compose` without its plugin, in the words of its
    /// releases before 28 and after; a `DOCKER_HOST` or a context that does not answer says something else.
    fn is_unknown_command(stderr: &str) -> bool {
        const UNKNOWN: [&str; 2] = ["is not a docker command", "unknown command"];

        UNKNOWN.iter().any(|words| stderr.contains(words))
    }

    /// Prints the batch's output on stdout as compose prints it, stdout and stderr together, the lines of the apps
    /// that run at once interleaved, as the Node CLI shows them. Once stdout can no longer be written, as a closed
    /// pipe, the batch goes on to its end unseen.
    async fn print(batch: &ComposeBatch) {
        let mut events = pin!(batch.output());
        let mut stdout = tokio::io::stdout();

        while let Some(event) = events.next().await {
            let written = match event {
                BatchEvent::Output { line, .. } => stdout.write_all(&line).await,
                BatchEvent::Skipped { events } => {
                    tracing::warn!(events, "the output fell behind: lines were lost");

                    Ok(())
                }
                BatchEvent::Started { .. } | BatchEvent::Finished(_) => Ok(()),
            };

            if let Err(error) = written {
                return Self::stop_printing(&error);
            }
        }

        if let Err(error) = stdout.flush().await {
            Self::stop_printing(&error);
        }
    }

    /// Says that the output stops: the batch is not stopped for it.
    fn stop_printing(error: &std::io::Error) {
        tracing::warn!(%error, "could not print the output, the command goes on");
    }

    /// The first failure of the batch, in the order it ran the apps in.
    async fn outcome(batch: &ComposeBatch) -> Result<(), Failure> {
        let report = batch.finished().await;
        let mut not_run = Vec::new();

        for outcome in report.apps {
            match outcome.status {
                AppStatus::Succeeded => {}
                AppStatus::Failed(error) => return Err(Failure::Batch(error)),
                AppStatus::NotRun => not_run.push(outcome.app.to_string()),
            }
        }

        if !not_run.is_empty() {
            return Err(Failure::NotRun { apps: not_run });
        }

        Ok(())
    }
}
