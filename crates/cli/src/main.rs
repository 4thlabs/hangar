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

    // Before the Tokio runtime starts any thread: reading `.env` sets the process's environment.
    if let Err(failure) = Environment::load() {
        return failure.report();
    }

    let tokio = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(tokio) => tokio,
        Err(error) => return Failure::Startup(error).report(),
    };

    tokio.block_on(async {
        // The second Ctrl-C cancels it, which stops the children still running.
        let cancellation = CancellationToken::new();
        let runtime = Runtime::with_cancellation(cancellation.clone());
        let hangar = Hangar::new(runtime.clone());

        Interrupts::new(runtime, cancellation)
            .run(cli.run(&hangar))
            .await
    })
}
