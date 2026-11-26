//! Ctrl-C: the first one lets the running children end and starts nothing new, the second stops them.

use std::future::Future;
use std::io;
use std::pin::pin;
use std::process::ExitCode;

use hangar_core::{CancellationToken, ComposeError, RunError, Runtime};

use crate::failure::Failure;
use crate::terminal::Terminal;

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
///
/// A child the [`Terminal`] is handed to, as a compose command passed through on one app, owns Ctrl-C, as when it is
/// run by hand: the binary says nothing, never stops it, and exits with its code once it ends, 0 included, and
/// without a failure line for a child that ended on SIGINT.
#[derive(Debug)]
pub(crate) struct Interrupts {
    runtime: Runtime,
    cancellation: CancellationToken,
    terminal: Terminal,
}

impl Interrupts {
    /// The code of an interrupted command, as a shell gives it: 128 and SIGINT.
    const INTERRUPTED: i32 = 130;

    /// Ctrl-C for the children of `runtime`, which `cancellation` cancels, unless one holds `terminal`.
    pub(crate) fn new(
        runtime: Runtime,
        cancellation: CancellationToken,
        terminal: Terminal,
    ) -> Self {
        Self {
            runtime,
            cancellation,
            terminal,
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

                return self.exit(command.await);
            }
        };

        tokio::select! {
            biased;
            outcome = &mut command => return self.exit(outcome),
            Some(()) = ctrl_c.recv() => {}
        }

        self.runtime.interrupt();

        if self.terminal.is_handed_over() {
            // The Ctrl-C reached the child, which alone decides when it ends: the next ones are left to it too.
            return Self::exit_as_child(command.await);
        }

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

    /// The code a command whose child held the terminal exits with: the child's, said only when it did not end on
    /// SIGINT, whether the binary heard the Ctrl-C before the child ended or not.
    fn exit_as_child(outcome: Result<(), Failure>) -> ExitCode {
        let Err(failure) = outcome else {
            return ExitCode::SUCCESS;
        };

        if Self::ended_on_sigint(&failure) {
            return Failure::exit(failure.exit_code());
        }

        failure.report()
    }

    /// Whether the child ended on SIGINT, killed by it or exiting with 130 as compose does.
    fn ended_on_sigint(failure: &Failure) -> bool {
        let Failure::Compose(ComposeError::Failed { source, .. }) = failure else {
            return false;
        };
        let is_child_end = matches!(source, RunError::Failed { .. } | RunError::Killed { .. });

        is_child_end && source.exit_code() == Self::INTERRUPTED
    }

    /// The code a command that was not interrupted exits with: that of the child holding the terminal, when one does,
    /// as its Ctrl-C may end it before the binary hears it.
    fn exit(&self, outcome: Result<(), Failure>) -> ExitCode {
        if self.terminal.is_handed_over() {
            return Self::exit_as_child(outcome);
        }

        match outcome {
            Ok(()) => ExitCode::SUCCESS,
            Err(failure) => failure.report(),
        }
    }
}
