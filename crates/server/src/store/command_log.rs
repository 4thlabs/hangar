//! The output of the commands the store runs for a request, `git` and `docker compose`, which goes to the log.

use hangar_core::Output;
use tokio::sync::mpsc;

use crate::failure::Failure;

/// An output whose lines the server logs, at `DEBUG`, the credentials of a URL taken out: a failed run keeps its
/// stderr's last lines in its error, which is logged whole, so the lines of a run that succeeds are only for whoever
/// asks for them.
#[derive(Debug)]
pub(crate) struct CommandLog;

impl CommandLog {
    /// The lines a reader takes at a time before the run waits for it.
    const BUFFER: usize = 64;

    /// An output whose lines are logged under `command`, as `git` or `docker compose down`, and `subject`, as the app.
    pub(crate) fn lines(command: &'static str, subject: impl Into<String>) -> Output {
        let (sender, mut receiver) = mpsc::channel::<Vec<u8>>(Self::BUFFER);
        let subject = subject.into();

        tokio::spawn(async move {
            while let Some(line) = receiver.recv().await {
                let line = String::from_utf8_lossy(&line);
                let line = Failure::redacted(line.trim_end());

                tracing::debug!(command, subject = %subject, line = %line, "output");
            }
        });

        Output::Lines(sender)
    }
}
