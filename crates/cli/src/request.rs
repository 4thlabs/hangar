//! A compose command as the command line asks for it: its target, the command and its options, read the way the Node
//! CLI reads them.

use hangar_core::{ComposeCommand, UpOptions};

use crate::failure::Failure;
use crate::target::Target;

/// A compose command on a target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ComposeRequest {
    /// What it runs on.
    pub(crate) target: Target,
    /// The command.
    pub(crate) command: ComposeCommand,
}

impl ComposeRequest {
    /// The names that are a command on every app rather than a target, as `store pull`: the Node CLI's
    /// `GlobalCommand`.
    const ON_EVERY_APP: [&str; 3] = ["up", "down", "pull"];

    /// `store <target> [command] [args...]`, the target first: `up`, `down` and `pull` are themselves the command, on
    /// every app. A target with no command runs `docker compose` alone, as the Node CLI does, which prints its help.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::NoTarget`] when `args` is empty.
    pub(crate) fn parse(args: &[String]) -> Result<Self, Failure> {
        let Some((name, rest)) = args.split_first() else {
            return Err(Failure::NoTarget);
        };

        if Self::ON_EVERY_APP.contains(&name.as_str()) {
            return Ok(Self::on_every_app(name, rest));
        }

        let command = match rest.split_first() {
            Some((command, options)) => Self::command(command, options),
            None => ComposeCommand::Args(Vec::new()),
        };

        Ok(Self {
            target: Target::Named(name.clone()),
            command,
        })
    }

    /// `store <command> [args...]`, on every app the categories list. `up` is always detached, as the Node CLI's
    /// `store up` passes `-d`: it would attach to the first app and never get to the others.
    pub(crate) fn on_every_app(command: &str, args: &[String]) -> Self {
        let line = std::iter::once(command.to_owned()).chain(args.iter().cloned());
        let detach = ComposeCommand::Args(line.collect())
            .is_attached()
            .then(|| "-d".to_owned());
        let options: Vec<String> = detach.into_iter().chain(args.iter().cloned()).collect();

        Self {
            target: Target::EveryApp,
            command: Self::command(command, &options),
        }
    }

    /// The command `name` with its `options`: a command Hangar types, as the Apps page runs it, when it is one, any
    /// other passed to compose as it is. An `up` that is not detached is passed through, and attaches to its app as
    /// compose's does.
    fn command(name: &str, options: &[String]) -> ComposeCommand {
        let line = std::iter::once(name.to_owned()).chain(options.iter().cloned());
        let passed = ComposeCommand::Args(line.collect());
        let typed = match name {
            "up" if !passed.is_attached() => Self::up_options(options).map(ComposeCommand::Up),
            "down" if options.is_empty() => Some(ComposeCommand::Down),
            "restart" if options.is_empty() => Some(ComposeCommand::Restart),
            "pull" if options.is_empty() => Some(ComposeCommand::Pull),
            _ => None,
        };

        typed.unwrap_or(passed)
    }

    /// The options of a typed `up`, detached, so `-d` changes nothing; `None` when another argument makes it a command
    /// passed as it is.
    fn up_options(options: &[String]) -> Option<UpOptions> {
        let mut up = UpOptions::default();
        let mut options = options.iter();

        while let Some(option) = options.next() {
            match option.as_str() {
                "-d" | "--detach" => {}
                "--force-recreate" => up.force_recreate = true,
                "--pull=always" => up.pull = true,
                "--pull" => {
                    let Some("always") = options.next().map(String::as_str) else {
                        return None;
                    };

                    up.pull = true;
                }
                _ => return None,
            }
        }

        Some(up)
    }
}

#[cfg(test)]
mod tests {
    use hangar_core::{ComposeCommand, UpOptions};

    use super::ComposeRequest;
    use crate::failure::Failure;
    use crate::target::Target;

    fn words(line: &[&str]) -> Vec<String> {
        line.iter().map(|word| (*word).to_owned()).collect()
    }

    fn parse(line: &[&str]) -> Result<ComposeRequest, Failure> {
        ComposeRequest::parse(&words(line))
    }

    fn passed(line: &[&str]) -> ComposeCommand {
        ComposeCommand::Args(words(line))
    }

    #[test]
    fn runs_a_command_on_a_named_target() {
        let request = parse(&["Media", "restart"]).expect("restart runs on a category");

        assert_eq!(request.target, Target::Named("Media".into()));
        assert_eq!(request.command, ComposeCommand::Restart);
    }

    #[test]
    fn takes_pull_alone_for_every_app() {
        let request = parse(&["pull"]).expect("pull runs on every app");

        assert_eq!(request.target, Target::EveryApp);
        assert_eq!(request.command, ComposeCommand::Pull);
    }

    #[test]
    fn types_an_up_that_is_detached_and_reads_its_options() {
        let up = |line: &[&str]| parse(line).expect("up takes its options").command;
        let pull_and_recreate = UpOptions {
            pull: true,
            force_recreate: true,
        };

        assert_eq!(
            up(&["jellyfin", "up", "-d"]),
            ComposeCommand::Up(UpOptions::default())
        );
        assert_eq!(
            up(&["up", "-d", "--pull", "always", "--force-recreate"]),
            ComposeCommand::Up(pull_and_recreate)
        );
        assert_eq!(
            up(&[
                "jellyfin",
                "up",
                "--detach",
                "--pull=always",
                "--force-recreate"
            ]),
            ComposeCommand::Up(pull_and_recreate)
        );
    }

    #[test]
    fn passes_an_up_that_is_not_detached_through_to_attach_as_the_node_cli() {
        let up = |line: &[&str]| parse(line).expect("up runs").command;

        assert_eq!(up(&["jellyfin", "up"]), passed(&["up"]));
        assert_eq!(
            up(&["Media", "up", "--force-recreate"]),
            passed(&["up", "--force-recreate"])
        );
        assert_eq!(up(&["jellyfin", "up", "--wait"]), passed(&["up", "--wait"]));
    }

    #[test]
    fn passes_any_other_command_through_as_it_is() {
        let request = parse(&["jellyfin", "logs", "-f", "--since", "2 hours"])
            .expect("logs is passed through");

        assert_eq!(request.target, Target::Named("jellyfin".into()));
        assert_eq!(
            request.command,
            passed(&["logs", "-f", "--since", "2 hours"])
        );
    }

    #[test]
    fn passes_a_typed_command_through_once_it_has_an_argument_hangar_does_not_type() {
        let command = |line: &[&str]| parse(line).expect("the command runs").command;

        assert_eq!(
            command(&["down", "--volumes"]),
            passed(&["down", "--volumes"])
        );
        assert_eq!(
            command(&["Media", "restart", "web"]),
            passed(&["restart", "web"])
        );
        assert_eq!(
            command(&["jellyfin", "up", "--pull", "missing"]),
            passed(&["up", "--pull", "missing"])
        );
        assert_eq!(
            command(&["jellyfin", "up", "--build"]),
            passed(&["up", "--build"])
        );
    }

    #[test]
    fn detaches_an_up_on_every_app_as_the_node_cli_does() {
        let up = |args: &[&str]| ComposeRequest::on_every_app("up", &words(args)).command;

        assert_eq!(up(&["--build"]), passed(&["up", "-d", "--build"]));
        assert_eq!(
            up(&["--build", "--wait"]),
            passed(&["up", "--build", "--wait"])
        );
        assert_eq!(up(&[]), ComposeCommand::Up(UpOptions::default()));
        assert_eq!(
            up(&["--detach=false"]),
            passed(&["up", "-d", "--detach=false"]),
            "the last value wins: the batch refuses it"
        );
    }

    #[test]
    fn runs_compose_alone_on_a_target_with_no_command() {
        let request = parse(&["jellyfin"]).expect("compose alone runs");

        assert_eq!(request.target, Target::Named("jellyfin".into()));
        assert_eq!(request.command, passed(&[]));
        assert!(matches!(parse(&[]), Err(Failure::NoTarget)));
    }
}
