//! The compose commands Hangar runs on an app, and the order a batch runs them in.

use std::fmt;

/// A `docker compose` command that Hangar runs on an installed app, as the Apps page and the CLI ask for it.
///
/// ```
/// use hangar_core::{ComposeCommand, UpOptions};
///
/// let update = ComposeCommand::Up(UpOptions { pull: true, force_recreate: true });
///
/// assert_eq!(update.args(), ["up", "-d", "--pull", "always", "--force-recreate"]);
/// assert_eq!(update.to_string(), "docker compose up -d --pull always --force-recreate");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ComposeCommand {
    /// `up -d`: creates and starts what is missing, with the options it carries.
    Up(UpOptions),
    /// `down`: stops and removes the app's containers and networks.
    Down,
    /// `restart`: restarts the app's containers.
    Restart,
    /// `pull`: pulls the app's images.
    Pull,
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
    pub fn args(&self) -> Vec<&'static str> {
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
        }
    }

    /// The order a batch runs this command in, as the Waku version's `CommandOrder`: `up` and `restart` forwards,
    /// `down` in reverse, `pull` in parallel.
    pub(crate) fn order(&self) -> Order {
        match self {
            Self::Up(_) | Self::Restart => Order::Forward,
            Self::Down => Order::Reverse,
            Self::Pull => Order::Parallel,
        }
    }
}

/// The command line, `docker compose up -d`, without the project and its files: what the output of a batch heads
/// each app with.
impl fmt::Display for ComposeCommand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "docker compose {}", self.args().join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::{ComposeCommand, Order, UpOptions};

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
}
