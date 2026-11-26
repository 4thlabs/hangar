//! The command line, as the Node CLI's commander definitions take it: `hangar store install`, `store up`,
//! `store down`, `store ls` and `store <target> <command>`; and `hangar user hash`, the Rust server's alone.

use std::process::ExitCode;

use clap::{Parser, Subcommand};

use crate::failure::Failure;
use crate::hangar::Hangar;
use crate::request::ComposeRequest;
use crate::user::UserCommands;

/// Hangar from a shell: the store and the compose commands on its apps.
#[derive(Debug, Parser)]
#[command(name = "hangar", version = hangar_core::VERSION, arg_required_else_help = true)]
pub(crate) struct Cli {
    #[command(subcommand)]
    command: Commands,
}

/// The commands of `hangar`.
#[derive(Debug, Subcommand)]
enum Commands {
    /// Commands for store management.
    #[command(
        arg_required_else_help = true,
        after_help = "\
hangar store <target> <command> [args...] runs any compose command on a target: an app by its id, a category of \
hangar.yml, or `pull` for every listed app. The arguments are passed to docker compose as they are. On one app, \
compose gets the terminal; on several, their output is printed on stdout, `up`, `start` and `restart` running one \
app at a time, `down` and `stop` in reverse, any other on every app at once.

Examples:
  hangar store up --pull always
  hangar store Media restart
  hangar store jellyfin logs -f"
    )]
    Store {
        #[command(subcommand)]
        command: StoreCommand,
    },

    /// Commands for the users of hangar.yml, who sign in to the Rust server.
    #[command(arg_required_else_help = true)]
    User {
        #[command(subcommand)]
        command: UserCommand,
    },
}

/// The commands of `hangar user`.
#[derive(Debug, Subcommand)]
enum UserCommand {
    /// Prints the argon2id hash of a password, for the `passwordHash` of a user in hangar.yml. The password is asked
    /// on the terminal, or read from the first line of stdin.
    Hash,
}

/// The commands of `hangar store`.
#[derive(Debug, Subcommand)]
enum StoreCommand {
    /// Installs or updates the store and links its apps.
    Install,

    /// Brings every listed app up, always detached, in the order of hangar.yml.
    Up {
        /// Passed to `docker compose up -d`.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },

    /// Takes every listed app down, in reverse order.
    Down {
        /// Passed to `docker compose down`.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },

    /// Shows the compose projects running on the host: `docker compose ls`.
    Ls {
        /// Passed to `docker compose ls`.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },

    /// `<target> <command> [args...]`: a compose command on an app, a category, or `pull` on every listed app.
    #[command(external_subcommand)]
    Target(Vec<String>),
}

impl Cli {
    /// Runs the command.
    pub(crate) async fn run(self, hangar: &Hangar) -> Result<(), Failure> {
        let command = match self.command {
            Commands::Store { command } => command,
            Commands::User {
                command: UserCommand::Hash,
            } => return UserCommands::hash().await,
        };

        match command {
            StoreCommand::Install => hangar.install().await,
            StoreCommand::Up { args } => {
                hangar
                    .compose(ComposeRequest::on_every_app("up", &args))
                    .await
            }
            StoreCommand::Down { args } => {
                hangar
                    .compose(ComposeRequest::on_every_app("down", &args))
                    .await
            }
            StoreCommand::Ls { args } => hangar.list(&args).await,
            StoreCommand::Target(args) => hangar.compose(ComposeRequest::parse(&args)?).await,
        }
    }

    /// Prints what clap has to say of a command line it does not run, the help included, and exits as the Node CLI
    /// does: 0 for the help and the version, 1 for a mistake.
    pub(crate) fn refuse(error: &clap::Error) -> ExitCode {
        // Nothing is left to report a failure to print to.
        let _ = error.print();

        if error.use_stderr() {
            return ExitCode::FAILURE;
        }

        ExitCode::SUCCESS
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{Cli, Commands, StoreCommand, UserCommand};

    fn store(args: &[&str]) -> StoreCommand {
        let cli = Cli::try_parse_from(["hangar", "store"].iter().chain(args))
            .expect("the command line parses");
        let Commands::Store { command } = cli.command else {
            panic!("`hangar store` is the store's command");
        };

        command
    }

    #[test]
    fn passes_the_options_of_up_through_as_they_come() {
        let StoreCommand::Up { args } = store(&["up", "-d", "--pull", "always"]) else {
            panic!("`store up` is the up command");
        };

        assert_eq!(args, ["-d", "--pull", "always"]);
    }

    #[test]
    fn takes_anything_else_as_a_target_and_its_command() {
        let StoreCommand::Target(args) = store(&["jellyfin", "logs", "-f"]) else {
            panic!("`store jellyfin` names a target");
        };

        assert_eq!(args, ["jellyfin", "logs", "-f"]);
    }

    #[test]
    fn takes_user_hash() {
        let cli = Cli::try_parse_from(["hangar", "user", "hash"]).expect("the command line parses");

        assert!(matches!(
            cli.command,
            Commands::User {
                command: UserCommand::Hash
            }
        ));
    }
}
