//! Ctrl-C: the first one lets the running children end and starts nothing new, the second stops them.

use std::future::Future;
use std::io;
use std::pin::pin;
use std::process::ExitCode;

use hangar_core::{CancellationToken, Runtime};

use crate::failure::Failure;

/// What hears Ctrl-C, and keeps one that comes while no one waits for it.
#[cfg(unix)]
type Listener = tokio::signal::unix::Signal;

/// What hears Ctrl-C, and keeps one that comes while no one waits for it.
#[cfg(windows)]
type Listener = tokio::signal::windows::CtrlC;

/// Runs a command to its end, through Ctrl-C.
///
/// A terminal's Ctrl-C reaches every process of its foreground group: the running children got SIGINT already, and
/// most end on it. The first Ctrl-C then [interrupts](Runtime::interrupt) the runtime, so that nothing new starts and
/// a batch stops at the app it was on, and the command ends once its children did. A child that does not end on
/// SIGINT is stopped by a second Ctrl-C, which cancels the runtime: SIGTERM, then SIGKILL after its grace period. A
/// third exits at once, without waiting for the children, which are killed as the binary exits.
///
/// An interrupted command exits with the code of the run that failed, 130 for a child that SIGINT killed, and with
/// 130 when nothing failed, as a shell gives an interrupted command.
#[derive(Debug)]
pub(crate) struct Interrupts {
    runtime: Runtime,
    cancellation: CancellationToken,
}

impl Interrupts {
    /// The code of an interrupted command, as a shell gives it: 128 and SIGINT.
    const INTERRUPTED: i32 = 130;

    /// Ctrl-C for the children of `runtime`, which `cancellation` cancels.
    pub(crate) fn new(runtime: Runtime, cancellation: CancellationToken) -> Self {
        Self {
            runtime,
            cancellation,
        }
    }

    /// Runs `command` to its end, and returns the code to exit with.
    pub(crate) async fn run(&self, command: impl Future<Output = Result<(), Failure>>) -> ExitCode {
        let mut command = pin!(command);
        // Listened from the start, and the same listener all along: a Ctrl-C that comes between two waits is kept for
        // the next one, where a listener made for each wait would miss it.
        let mut ctrl_c = match Self::listen() {
            Ok(ctrl_c) => ctrl_c,
            Err(error) => {
                tracing::warn!(%error, "cannot listen for Ctrl-C");

                return Self::exit(command.await);
            }
        };

        tokio::select! {
            biased;
            outcome = &mut command => return Self::exit(outcome),
            Some(()) = ctrl_c.recv() => {}
        }

        self.runtime.interrupt();
        tracing::warn!(
            "interrupted: waiting for the running commands to end, Ctrl-C again stops them"
        );

        let outcome = tokio::select! {
            biased;
            outcome = &mut command => outcome,
            Some(()) = ctrl_c.recv() => {
                tracing::warn!("stopping the running commands, Ctrl-C again exits without waiting for them");
                self.cancellation.cancel();

                tokio::select! {
                    biased;
                    outcome = &mut command => outcome,
                    // A child that ignores SIGTERM too, or a pipe that a grandchild holds open, is left behind.
                    Some(()) = ctrl_c.recv() => return Failure::exit(Self::INTERRUPTED),
                }
            }
        };

        match outcome {
            Ok(()) => Failure::exit(Self::INTERRUPTED),
            Err(failure) => failure.report(),
        }
    }

    /// Listens for Ctrl-C: SIGINT.
    #[cfg(unix)]
    fn listen() -> io::Result<Listener> {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
    }

    /// Listens for Ctrl-C.
    #[cfg(windows)]
    fn listen() -> io::Result<Listener> {
        tokio::signal::windows::ctrl_c()
    }

    /// The code a command that was not interrupted exits with.
    fn exit(outcome: Result<(), Failure>) -> ExitCode {
        match outcome {
            Ok(()) => ExitCode::SUCCESS,
            Err(failure) => failure.report(),
        }
    }
}
