//! The compose commands Hangar runs on an app, and the order a batch runs them in.

use std::fmt;

/// A `docker compose` command that Hangar runs on an installed app, as the Apps page and the CLI ask for it: one it
/// types, or any other, as its arguments.
///
/// ```
/// use hangar_core::{ComposeCommand, UpOptions};
///
/// let update = ComposeCommand::Up(UpOptions { pull: true, force_recreate: true });
/// let logs = ComposeCommand::Args(vec!["logs".into(), "-f".into()]);
///
/// assert_eq!(update.args(), ["up", "-d", "--pull", "always", "--force-recreate"]);
/// assert_eq!(update.to_string(), "docker compose up -d --pull always --force-recreate");
/// assert_eq!(logs.args(), ["logs", "-f"]);
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ComposeCommand {
    /// `up -d`: creates and starts what is missing, with the options it carries.
    Up(UpOptions),
    /// `down`: stops and removes the app's containers and networks.
    Down,
    /// `restart`: restarts the app's containers.
    Restart,
    /// `pull`: pulls the app's images.
    Pull,
    /// Any command, as its arguments after the project and its file, passed to compose as they are: `logs -f`,
    /// `exec web sh`, `down --volumes`, as the CLI passes them through. None at all runs `docker compose` alone, which
    /// prints its help.
    ///
    /// The first word is the command's name, and the project and the file stay the app's: a word before the name
    /// that starts with `-`, as `-p traefik down`, is refused, as compose would take it for one of its own options.
    ///
    /// The name gives the order of a batch, as the Node CLI's `CommandOrder`: `up`, `start` and `restart` forwards,
    /// `down` and `stop` in reverse, any other on every app at once. An `up` that is not
    /// [detached](Self::is_attached) attaches to its app and does not end: a batch takes it on one app alone.
    Args(Vec<String>),
}

/// What `up` adds to `up -d`. The arguments come in this order, whatever order they were asked in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct UpOptions {
    /// `--pull always`: pulls every image first, which updates the app.
    pub pull: bool,
    /// `--force-recreate`: recreates the containers even when nothing changed.
    pub force_recreate: bool,
}

/// The order a batch runs a command over its apps in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Order {
    /// One at a time, in the order `hangar.yml` lists the apps, so that a reverse proxy listed first comes up first.
    Forward,
    /// One at a time, in reverse, so that it goes down last.
    Reverse,
    /// All at once.
    Parallel,
}

impl ComposeCommand {
    /// The arguments of `docker compose` after the project and its file, as the Waku version passes them.
    pub fn args(&self) -> Vec<&str> {
        match self {
            Self::Up(options) => {
                let mut args = vec!["up", "-d"];

                if options.pull {
                    args.extend(["--pull", "always"]);
                }

                if options.force_recreate {
                    args.push("--force-recreate");
                }

                args
            }
            Self::Down => vec!["down"],
            Self::Restart => vec!["restart"],
            Self::Pull => vec!["pull"],
            Self::Args(args) => args.iter().map(String::as_str).collect(),
        }
    }

    /// The order a batch runs this command in, as the Waku version's `CommandOrder`: `up`, `start` and `restart`
    /// forwards, `down` and `stop` in reverse, any other, as `pull`, in parallel.
    pub(crate) fn order(&self) -> Order {
        match self.args().first().copied() {
            Some("up" | "start" | "restart") => Order::Forward,
            Some("down" | "stop") => Order::Reverse,
            _ => Order::Parallel,
        }
    }

    /// Whether the command attaches to its app and runs until it is stopped: an [`Args`](Self::Args) `up` that
    /// nothing detaches, neither `-d`, `--detach` nor `--wait`, as a flag, with a true value or in a group of short
    /// flags, as `-dV`. The typed [`Up`](Self::Up) is always detached.
    ///
    /// ```
    /// use hangar_core::ComposeCommand;
    ///
    /// let up = |line: &[&str]| ComposeCommand::Args(line.iter().map(|word| word.to_string()).collect());
    ///
    /// assert!(up(&["up", "--build"]).is_attached());
    /// assert!(!up(&["up", "--build", "--wait"]).is_attached());
    /// ```
    pub fn is_attached(&self) -> bool {
        let Self::Args(args) = self else {
            return false;
        };
        let is_detached = args.iter().any(|arg| Self::detaches(arg));

        args.first().is_some_and(|name| name == "up") && !is_detached
    }

    /// The word starting with `-` that an [`Args`](Self::Args) holds before its command's name, which compose would
    /// take for one of its own options, as `-p` or `-f`.
    pub(crate) fn leading_option(&self) -> Option<&str> {
        let Self::Args(args) = self else {
            return None;
        };

        args.first()
            .map(String::as_str)
            .filter(|word| word.starts_with('-'))
    }

    /// Whether `arg` detaches an `up`: `--detach` or `--wait`, which detaches too, alone or with a true value, as
    /// `pflag` reads a boolean, or a group of short flags holding `d`, as `-d` or `-dV`.
    fn detaches(arg: &str) -> bool {
        if let Some(long) = arg.strip_prefix("--") {
            let (name, value) = match long.split_once('=') {
                Some((name, value)) => (name, Some(value)),
                None => (long, None),
            };

            return matches!(name, "detach" | "wait") && value.is_none_or(Self::is_true);
        }

        arg.strip_prefix('-').is_some_and(|group| {
            group.contains('d') && group.chars().all(|flag| flag.is_ascii_alphabetic())
        })
    }

    /// Whether `pflag` reads `value` as true.
    fn is_true(value: &str) -> bool {
        matches!(value, "1" | "t" | "T" | "true" | "TRUE" | "True")
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

/// The command line, `docker compose up -d`, without the project and its files, each word quoted for a shell where it
/// needs to be: what the output of a batch heads each app with, and its errors.
impl fmt::Display for ComposeCommand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("docker compose")?;

        for word in self.args() {
            write!(f, " {}", Self::shell_word(word))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{ComposeCommand, Order, UpOptions};

    fn args(line: &[&str]) -> ComposeCommand {
        ComposeCommand::Args(line.iter().map(|arg| (*arg).to_owned()).collect())
    }

    #[test]
    fn passes_the_arguments_of_each_command() {
        let plain = ComposeCommand::Up(UpOptions::default());
        let recreate = ComposeCommand::Up(UpOptions {
            pull: false,
            force_recreate: true,
        });

        assert_eq!(plain.args(), ["up", "-d"]);
        assert_eq!(recreate.args(), ["up", "-d", "--force-recreate"]);
        assert_eq!(ComposeCommand::Down.args(), ["down"]);
        assert_eq!(ComposeCommand::Restart.args(), ["restart"]);
        assert_eq!(ComposeCommand::Pull.args(), ["pull"]);
        assert_eq!(
            args(&["exec", "web", "sh", "-c", "echo $HOME"]).args(),
            ["exec", "web", "sh", "-c", "echo $HOME"]
        );
    }

    #[test]
    fn runs_up_and_restart_forwards_down_in_reverse_and_pull_at_once() {
        assert_eq!(
            ComposeCommand::Up(UpOptions::default()).order(),
            Order::Forward
        );
        assert_eq!(ComposeCommand::Restart.order(), Order::Forward);
        assert_eq!(ComposeCommand::Down.order(), Order::Reverse);
        assert_eq!(ComposeCommand::Pull.order(), Order::Parallel);
    }

    #[test]
    fn orders_a_command_passed_as_its_arguments_by_its_name_as_the_node_cli() {
        for name in ["up", "start", "restart"] {
            assert_eq!(args(&[name, "web"]).order(), Order::Forward, "{name}");
        }

        for name in ["down", "stop"] {
            assert_eq!(args(&[name, "--volumes"]).order(), Order::Reverse, "{name}");
        }

        for line in [&["logs", "-f"][..], &["ps"], &["pull", "--quiet"], &[]] {
            assert_eq!(args(line).order(), Order::Parallel, "{line:?}");
        }
    }

    #[test]
    fn tells_an_up_that_attaches_from_one_that_detaches() {
        for line in [
            &["up"][..],
            &["up", "--build", "web"],
            &["up", "--detach=false"],
            &["up", "--wait=0"],
            &["up", "-V"],
            &["up", "--dry-run"],
        ] {
            assert!(args(line).is_attached(), "{line:?}");
        }

        for line in [
            &["up", "--build", "-d"][..],
            &["up", "--detach"],
            &["up", "--detach=true"],
            &["up", "--wait"],
            &["up", "--wait=1"],
            &["up", "-dV"],
            &["up", "-Vd"],
        ] {
            assert!(!args(line).is_attached(), "{line:?}");
        }

        assert!(!args(&["logs", "-f"]).is_attached());
        assert!(!ComposeCommand::Up(UpOptions::default()).is_attached());
    }

    #[test]
    fn finds_an_option_before_the_command_s_name() {
        assert_eq!(
            args(&["-p", "traefik", "down"]).leading_option(),
            Some("-p")
        );
        assert_eq!(
            args(&["--profile", "web", "up"]).leading_option(),
            Some("--profile")
        );
        assert_eq!(args(&["down", "-v"]).leading_option(), None);
        assert_eq!(args(&[]).leading_option(), None);
    }

    #[test]
    fn quotes_the_words_of_its_command_line_that_a_shell_would_split_or_read_otherwise() {
        let logs = args(&["logs", "--since", "2 hours", "it's", "$HOME", ""]);

        assert_eq!(
            logs.to_string(),
            r#"docker compose logs --since '2 hours' 'it'\''s' '$HOME' ''"#
        );
        assert_eq!(args(&[]).to_string(), "docker compose");
    }
}
