//! `hangar user`: what a user of `hangar.yml` needs from a shell.

use std::io::{self, BufRead, IsTerminal, Write};

use hangar_core::PasswordHash;

use crate::failure::Failure;

/// The commands of `hangar user`.
#[derive(Debug)]
pub(crate) struct UserCommands;

impl UserCommands {
    /// `user hash`: prints the argon2id hash of a password, for the `passwordHash` of a user in `hangar.yml`.
    ///
    /// On a terminal, the password is asked twice, without echo; otherwise its first line is read from stdin, so that
    /// a script pipes it in. The hash alone goes to stdout. Hashing blocks for some 50 ms, off the runtime's thread.
    pub(crate) async fn hash() -> Result<(), Failure> {
        let hash = tokio::task::spawn_blocking(|| -> Result<PasswordHash, Failure> {
            Ok(PasswordHash::new(&Self::read_password()?)?)
        })
        .await
        .map_err(|error| Failure::Startup(io::Error::other(error)))??;
        let mut stdout = io::stdout().lock();

        writeln!(stdout, "{hash}").map_err(Failure::Write)
    }

    /// The password, typed twice on the terminal or read from stdin.
    fn read_password() -> Result<String, Failure> {
        if !io::stdin().is_terminal() {
            return Self::read_line(io::stdin().lock());
        }

        let password = rpassword::prompt_password("Password: ").map_err(Failure::ReadPassword)?;
        let again = rpassword::prompt_password("Again: ").map_err(Failure::ReadPassword)?;

        if password != again {
            return Err(Failure::PasswordMismatch);
        }

        Ok(password)
    }

    /// The first line of `input`, without its line ending.
    fn read_line(mut input: impl BufRead) -> Result<String, Failure> {
        let mut line = String::new();

        input.read_line(&mut line).map_err(Failure::ReadPassword)?;

        let password = line
            .strip_suffix('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line))
            .unwrap_or(&line);

        Ok(password.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::UserCommands;

    #[test]
    fn reads_the_first_line_without_its_ending() {
        for input in [
            "correct horse\n",
            "correct horse\r\n",
            "correct horse",
            "correct horse\nmore\n",
        ] {
            let password = UserCommands::read_line(input.as_bytes()).expect("read");

            assert_eq!(password, "correct horse", "{input:?}");
        }
    }

    #[test]
    fn keeps_the_spaces_of_a_password() {
        let password = UserCommands::read_line(" correct horse \n".as_bytes()).expect("read");

        assert_eq!(password, " correct horse ");
    }
}
