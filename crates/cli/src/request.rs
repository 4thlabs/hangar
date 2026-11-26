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

    /// `store <target> <command> [args...]`, the target first: `up`, `down` and `pull` are themselves the command, on
    /// every app.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::NoCommand`] when no command follows the target, and [`Failure::Unsupported`] for a command
    /// or an argument the Rust binary does not run.
    pub(crate) fn parse(args: &[String]) -> Result<Self, Failure> {
        let Some((name, rest)) = args.split_first() else {
            return Err(Failure::NoCommand);
        };

        if Self::ON_EVERY_APP.contains(&name.as_str()) {
            return Self::on_every_app(name, rest);
        }

        let command = Self::command(name, rest)?;

        Ok(Self {
            target: Target::Named(name.clone()),
            command,
        })
    }

    /// `store <command> [args...]`, on every app the categories list.
    ///
    /// # Errors
    ///
    /// Returns [`Failure::Unsupported`] as [`parse`](Self::parse) does.
    pub(crate) fn on_every_app(command: &str, args: &[String]) -> Result<Self, Failure> {
        let line: Vec<String> = std::iter::once(command.to_owned())
            .chain(args.iter().cloned())
            .collect();
        let command = Self::command("", &line)?;

        Ok(Self {
            target: Target::EveryApp,
            command,
        })
    }

    /// The command that `line` names after `target`, empty for every app.
    fn command(target: &str, line: &[String]) -> Result<ComposeCommand, Failure> {
        let Some((command, options)) = line.split_first() else {
            return Err(Failure::NoCommand);
        };
        let unsupported = |what: String| Failure::Unsupported {
            what,
            node_command: Self::node_command(target, line),
        };

        let command = match command.as_str() {
            "up" => ComposeCommand::Up(Self::up_options(options).map_err(unsupported)?),
            "down" => ComposeCommand::Down,
            "restart" => ComposeCommand::Restart,
            "pull" => ComposeCommand::Pull,
            other => return Err(unsupported(format!("`{other}`"))),
        };

        if !matches!(command, ComposeCommand::Up(_))
            && let Some(option) = options.first()
        {
            return Err(unsupported(format!("`{option}`")));
        }

        Ok(command)
    }

    /// The options of `up`: it always runs detached, so `-d` changes nothing. Returns the first other argument, to be
    /// refused.
    fn up_options(options: &[String]) -> Result<UpOptions, String> {
        let mut up = UpOptions::default();
        let mut options = options.iter();

        while let Some(option) = options.next() {
            match option.as_str() {
                "-d" | "--detach" => {}
                "--force-recreate" => up.force_recreate = true,
                "--pull=always" => up.pull = true,
                "--pull" => {
                    let Some("always") = options.next().map(String::as_str) else {
                        return Err("`--pull` other than `--pull always`".to_owned());
                    };

                    up.pull = true;
                }
                other => return Err(format!("`{other}`")),
            }
        }

        Ok(up)
    }

    /// The Node CLI's command line for the same request, each word quoted for a shell where it needs to be.
    fn node_command(target: &str, line: &[String]) -> String {
        let words = std::iter::once(target)
            .filter(|target| !target.is_empty())
            .chain(line.iter().map(String::as_str))
            .map(Self::shell_word);

        format!(
            "node bin/cli.js store {}",
            words.collect::<Vec<_>>().join(" ")
        )
    }

    /// `word` as a shell reads it back: as it is when it holds only characters no shell treats apart, else in single
    /// quotes, a `'` in it closed, escaped and opened again.
    fn shell_word(word: &str) -> String {
        let is_plain = !word.is_empty()
            && word.chars().all(|character| {
                character.is_ascii_alphanumeric() || "-_./:=@%+,".contains(character)
            });

        if is_plain {
            return word.to_owned();
        }

        format!("'{}'", word.replace('\'', r"'\''"))
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
    fn reads_the_options_of_up_and_detaches_all_the_same() {
        let up = |line: &[&str]| parse(line).expect("up takes its options").command;
        let pull_and_recreate = UpOptions {
            pull: true,
            force_recreate: true,
        };

        assert_eq!(
            up(&["jellyfin", "up"]),
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
    fn refuses_another_command_and_names_the_node_cli_for_it() {
        let Err(failure) = parse(&["jellyfin", "logs", "-f"]) else {
            panic!("logs is not run by the Rust binary");
        };

        assert_eq!(
            failure.to_string(),
            "`logs` is not in the Rust binary yet: run `node bin/cli.js store jellyfin logs -f`"
        );
    }

    #[test]
    fn refuses_an_argument_it_does_not_pass_on() {
        let refused = |line: &[&str]| {
            parse(line)
                .expect_err("the argument is refused")
                .to_string()
        };

        assert_eq!(
            refused(&["down", "--volumes"]),
            "`--volumes` is not in the Rust binary yet: run `node bin/cli.js store down --volumes`"
        );
        assert!(refused(&["up", "--pull", "missing"]).starts_with("`--pull` other than"));
        assert!(refused(&["jellyfin", "up", "--wait"]).starts_with("`--wait`"));
    }

    #[test]
    fn quotes_the_words_a_shell_would_split_or_read_otherwise() {
        let refused = parse(&[
            "jellyfin", "logs", "--since", "2 hours", "it's", "$HOME", "",
        ])
        .expect_err("logs is refused")
        .to_string();

        assert!(
            refused.ends_with(r#"run `node bin/cli.js store jellyfin logs --since '2 hours' 'it'\''s' '$HOME' ''`"#),
            "{refused}"
        );
    }

    #[test]
    fn needs_a_command_after_the_target() {
        assert!(matches!(parse(&["jellyfin"]), Err(Failure::NoCommand)));
    }
}
