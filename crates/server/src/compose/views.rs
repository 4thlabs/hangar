//! What the page reads of a batch: the core's command, events and report as the contract writes them.

use hangar_api::{
    ComposeAction, ComposeEvent, ComposeOutcome, ComposeReport, ComposeStatus, ErrorCode,
    ErrorDetail,
};
use hangar_core::{
    AppOutcome, AppStatus, BatchEvent, BatchReport, ComposeCommand, ComposeError, Secrets,
    UpOptions,
};

use crate::failure::Failure;

/// The contract's view of the core's batches.
#[derive(Debug)]
pub(crate) struct ComposeViews;

impl ComposeViews {
    /// The core's command of `action`.
    pub(crate) fn command(action: ComposeAction) -> ComposeCommand {
        match action {
            ComposeAction::Up {
                pull,
                force_recreate,
            } => ComposeCommand::Up(UpOptions {
                pull,
                force_recreate,
            }),
            ComposeAction::Restart => ComposeCommand::Restart,
            ComposeAction::Down => ComposeCommand::Down,
        }
    }

    /// The operation of `action`, as a notification names it: `up`, `restart` or `down`.
    pub(crate) fn operation(action: ComposeAction) -> &'static str {
        match action {
            ComposeAction::Up { .. } => "up",
            ComposeAction::Restart => "restart",
            ComposeAction::Down => "down",
        }
    }

    /// The options of `action`, as a notification names them, comma-separated in the order of the command's
    /// arguments: `pull,forceRecreate`; empty for none.
    pub(crate) fn flags(action: ComposeAction) -> String {
        let ComposeAction::Up {
            pull,
            force_recreate,
        } = action
        else {
            return String::new();
        };
        let flags = [(pull, "pull"), (force_recreate, "forceRecreate")];

        flags
            .into_iter()
            .filter_map(|(is_set, flag)| is_set.then_some(flag))
            .collect::<Vec<_>>()
            .join(",")
    }

    /// `event` of a batch of `command`, the command line, as the page reads it, a line masked of `secrets` and of the
    /// credentials of a URL, as compose's complaint about a file is.
    pub(crate) fn event(event: BatchEvent, command: &str, secrets: &Secrets) -> ComposeEvent {
        match event {
            BatchEvent::Started { app } => ComposeEvent::Started {
                app: app.to_string(),
            },
            BatchEvent::Output { app, line } => ComposeEvent::Line {
                app: app.to_string(),
                // The credentials first: a value masked out of a URL, as `https`, would hide it from their pattern.
                line: secrets.mask(&Failure::redacted(&Self::line(&line))),
            },
            BatchEvent::Finished(outcome) => {
                ComposeEvent::Finished(Self::outcome(&outcome, command))
            }
            BatchEvent::Skipped { events } => ComposeEvent::Skipped { events },
        }
    }

    /// `report` of a batch of `command`, as the page reads it.
    pub(crate) fn report(report: &BatchReport, command: &str) -> ComposeReport {
        ComposeReport {
            apps: report
                .apps
                .iter()
                .map(|outcome| Self::outcome(outcome, command))
                .collect(),
        }
    }

    /// How a batch of `command` ended on an app, and why it failed: an app uninstalled meanwhile, or the command,
    /// whose output says why, never in the error.
    fn outcome(outcome: &AppOutcome, command: &str) -> ComposeOutcome {
        let app = outcome.app.to_string();
        let (status, error) = match &outcome.status {
            AppStatus::Succeeded => (ComposeStatus::Succeeded, None),
            AppStatus::NotRun => (ComposeStatus::NotRun, None),
            AppStatus::Failed(error) => {
                let code = match &**error {
                    ComposeError::NotInstalled { app } => ErrorCode::UnknownProject {
                        project: app.clone(),
                    },
                    _ => ErrorCode::ComposeFailed {
                        app: app.clone(),
                        command: command.to_owned(),
                    },
                };

                (ComposeStatus::Failed, Some(ErrorDetail::from(code)))
            }
        };

        ComposeOutcome { app, status, error }
    }

    /// A line of compose's output as text, without its line break: compose writes UTF-8, and a byte that is not is
    /// replaced rather than lose the line.
    fn line(line: &[u8]) -> String {
        String::from_utf8_lossy(line)
            .trim_end_matches(['\n', '\r'])
            .to_owned()
    }
}

#[cfg(test)]
mod tests {
    use hangar_api::ComposeAction;

    use super::ComposeViews;

    #[test]
    fn names_the_options_of_up_as_the_waku_version_s_notifications() {
        let up = |pull, force_recreate| ComposeAction::Up {
            pull,
            force_recreate,
        };

        assert_eq!(ComposeViews::flags(up(true, true)), "pull,forceRecreate");
        assert_eq!(ComposeViews::flags(up(false, true)), "forceRecreate");
        assert_eq!(ComposeViews::flags(up(false, false)), "");
        assert_eq!(ComposeViews::flags(ComposeAction::Down), "");
        assert_eq!(
            ComposeViews::command(up(true, true)).to_string(),
            "docker compose up -d --pull always --force-recreate"
        );
    }

    #[test]
    fn takes_the_credentials_of_a_url_out_whatever_value_is_masked() {
        let secrets = hangar_core::Secrets::new(["https", "s3cret"]);
        let line = hangar_core::BatchEvent::Output {
            app: "alpha".into(),
            line: b"pull https://ana:registry-token@registry.example.com/image\n".to_vec(),
        };

        assert_eq!(
            ComposeViews::event(line, "docker compose pull", &secrets),
            hangar_api::ComposeEvent::Line {
                app: "alpha".to_owned(),
                line: "pull ***://***@registry.example.com/image".to_owned(),
            }
        );
    }

    #[test]
    fn reads_a_line_without_its_line_break() {
        assert_eq!(
            ComposeViews::line(b" Container alpha  Started\r\n"),
            " Container alpha  Started"
        );
        assert_eq!(ComposeViews::line(b"caf\xc3\xa9 \xff\n"), "café \u{fffd}");
    }
}
