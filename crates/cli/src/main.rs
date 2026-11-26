//! `hangar`: Hangar from a shell, on `hangar-core`. It installs the store and brings its apps up and down, with the
//! commands and the targets of the Node CLI, `bin/cli.js`, so that the same invocations work with both until the
//! switch.

mod cli;
mod environment;
mod failure;
mod hangar;
mod interrupts;
mod request;
mod target;

use std::io::IsTerminal;
use std::process::ExitCode;

use clap::Parser;
use hangar_core::{CancellationToken, Runtime};

use cli::Cli;
use environment::Environment;
use failure::Failure;
use hangar::Hangar;
use interrupts::Interrupts;

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => return Cli::refuse(&error),
    };

    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(std::io::stderr().is_terminal())
        .with_target(false)
        .init();

    let environment = match Environment::load() {
        Ok(environment) => environment,
        Err(failure) => return failure.report(),
    };

    let tokio = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(tokio) => tokio,
        Err(error) => return Failure::Startup(error).report(),
    };

    let exit = tokio.block_on(async {
        // The second Ctrl-C cancels it, which stops the children still running.
        let cancellation = CancellationToken::new();
        let runtime = Runtime::with_cancellation(cancellation.clone())
            .envs(environment.file_variables().clone());
        let hangar = Hangar::new(runtime.clone(), environment);

        Interrupts::new(runtime, cancellation)
            .run(cli.run(&hangar))
            .await
    });

    // Without waiting for a write to a stdout that no one reads: the third Ctrl-C exits at once. The children still
    // running are killed as their tasks are dropped.
    tokio.shutdown_background();

    exit
}
