//! The settings of the server, read from the environment once at the start, as the Waku version reads them in
//! `src/libs/env/env.ts`: a value that is missing or bad stops the server with a message that names its variable.

mod auth;

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use hangar_core::{DataDir, Environment, StoreError};

pub use auth::{AuthSettings, OidcSettings};

/// What the server reads from the environment. A variable that is empty is not set, as the `hangar` binary reads it.
///
/// ```
/// use std::collections::HashMap;
///
/// use hangar_server::Settings;
///
/// let variables = HashMap::from([
///     ("HANGAR_DATA_DIR", "/srv/hangar"),
///     ("HANGAR_STORE_URL", "https://example.com/store.git"),
///     ("DOMAIN", "example.com"),
///     ("HANGAR_URL", "https://hangar.example.com"),
///     ("HANGAR_SECRET", "0123456789abcdef0123456789abcdef"),
/// ]);
/// let settings = Settings::read(|name| variables.get(name).map(|value| value.to_string()))?;
///
/// assert_eq!(settings.domain, "example.com");
/// assert_eq!(settings.address.to_string(), "0.0.0.0:3010");
/// assert!(settings.github_token.is_none());
/// assert!(settings.auth.oidc.is_none());
/// # Ok::<(), hangar_server::SettingsError>(())
/// ```
#[derive(Debug, Clone)]
pub struct Settings {
    /// Where the server listens, from `HOST`, an IP address, and `PORT`, as the image sets them: `0.0.0.0:3010`
    /// unless they say otherwise.
    pub address: SocketAddr,
    /// The data directory, from `HANGAR_DATA_DIR`.
    pub data_dir: DataDir,
    /// The git URL of the store, from `HANGAR_STORE_URL`.
    pub store_url: String,
    /// The domain the apps are served under, `<container>.<DOMAIN>`, from `DOMAIN`.
    pub domain: String,
    /// The token the GitHub releases widget calls GitHub with, from `GITHUB_TOKEN`.
    pub github_token: Option<Secret>,
    /// The key the Finnhub widget calls Finnhub with, from `FINNHUB_API_KEY`.
    pub finnhub_api_key: Option<Secret>,
    /// The host the terminal signs in to over SSH, from `HANGAR_SSH_HOST`.
    pub ssh_host: Option<String>,
    /// The user the terminal signs in as, from `HANGAR_SSH_USER`.
    pub ssh_user: Option<String>,
    /// The port of the SSH server, 1 to 65535, from `HANGAR_SSH_PORT`.
    pub ssh_port: Option<u16>,
    /// The directory of the page the server serves beside its API, the Vite build of `web/`, from `HANGAR_PAGE_DIR`.
    /// Unset, the server serves its API alone, as in development, where Vite serves the page.
    pub page: Option<PathBuf>,
    /// How users sign in: the page's URL, the cookies' secret, and the OpenID Connect provider.
    pub auth: AuthSettings,
}

impl Settings {
    /// The variable of the address the server listens on.
    pub const HOST: &str = "HOST";
    /// The variable of the port the server listens on.
    pub const PORT: &str = "PORT";
    /// The variable of the store's URL.
    pub const STORE_URL: &str = Environment::STORE_URL;
    /// The variable of the domain.
    pub const DOMAIN: &str = "DOMAIN";
    /// The variable of GitHub's token.
    pub const GITHUB_TOKEN: &str = "GITHUB_TOKEN";
    /// The variable of Finnhub's key.
    pub const FINNHUB_API_KEY: &str = "FINNHUB_API_KEY";
    /// The variable of the SSH host.
    pub const SSH_HOST: &str = "HANGAR_SSH_HOST";
    /// The variable of the SSH user.
    pub const SSH_USER: &str = "HANGAR_SSH_USER";
    /// The variable of the SSH port.
    pub const SSH_PORT: &str = "HANGAR_SSH_PORT";
    /// The variable of the page's directory.
    pub const PAGE_DIR: &str = "HANGAR_PAGE_DIR";

    /// The address the server listens on without `HOST`: every interface, as in the image.
    const DEFAULT_HOST: IpAddr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
    /// The port the server listens on without `PORT`: the Waku version's, which the image publishes.
    const DEFAULT_PORT: u16 = 3010;

    /// The file a page's directory must hold, which the server answers for `/`.
    const PAGE_INDEX: &str = "index.html";

    /// The settings of `environment`: the process's variables, then those of the working directory's `.env`.
    ///
    /// # Errors
    ///
    /// Returns a [`SettingsError`] that lists every variable missing or bad, as [`read`](Self::read) does.
    pub fn from_environment(environment: &Environment) -> Result<Self, SettingsError> {
        Self::read(|name| environment.variable(name))
    }

    /// The settings that `variable` gives, by the name of each variable; `None`, or an empty value, is not set.
    ///
    /// # Errors
    ///
    /// Returns a [`SettingsError`] that lists every variable missing or bad: `HANGAR_DATA_DIR`, `HANGAR_STORE_URL` or
    /// `DOMAIN` not set, a `HOST` that is no IP address, a data directory that is no usable path, a port that is not 1
    /// to 65535, a page's directory with no `index.html`, and those of [`AuthSettings`]: `HANGAR_URL` that is no
    /// `http` origin, `HANGAR_SECRET` shorter than 32 bytes, or a provider's issuer without its client id.
    pub fn read(variable: impl Fn(&str) -> Option<String>) -> Result<Self, SettingsError> {
        let variable = |name: &str| variable(name).filter(|value| !value.is_empty());

        // Each read on its own, so that the error names every variable at fault, not the first alone.
        let host = Self::host(variable(Self::HOST));
        let port = Self::port(Self::PORT, variable(Self::PORT));
        let data_dir = Self::data_dir(variable(DataDir::VARIABLE));
        let store_url = Self::required(Self::STORE_URL, variable(Self::STORE_URL));
        let domain = Self::required(Self::DOMAIN, variable(Self::DOMAIN));
        let ssh_port = Self::port(Self::SSH_PORT, variable(Self::SSH_PORT));
        let page = Self::page(variable(Self::PAGE_DIR));
        let auth = AuthSettings::read(variable);

        match (
            host, port, data_dir, store_url, domain, ssh_port, page, auth,
        ) {
            (
                Ok(host),
                Ok(port),
                Ok(data_dir),
                Ok(store_url),
                Ok(domain),
                Ok(ssh_port),
                Ok(page),
                Ok(auth),
            ) => Ok(Self {
                address: SocketAddr::new(host, port.unwrap_or(Self::DEFAULT_PORT)),
                data_dir,
                store_url,
                domain,
                github_token: variable(Self::GITHUB_TOKEN).map(Secret),
                finnhub_api_key: variable(Self::FINNHUB_API_KEY).map(Secret),
                ssh_host: variable(Self::SSH_HOST),
                ssh_user: variable(Self::SSH_USER),
                ssh_port,
                page,
                auth,
            }),
            (host, port, data_dir, store_url, domain, ssh_port, page, auth) => {
                let errors = [
                    host.err(),
                    port.err(),
                    data_dir.err(),
                    store_url.err(),
                    domain.err(),
                    ssh_port.err(),
                    page.err(),
                ];

                Err(SettingsError {
                    errors: errors
                        .into_iter()
                        .flatten()
                        .chain(auth.err().into_iter().flatten())
                        .collect(),
                })
            }
        }
    }

    /// The value of a variable that must be set.
    fn required(name: &'static str, value: Option<String>) -> Result<String, SettingError> {
        value.ok_or(SettingError::NotSet { variable: name })
    }

    /// The IP address `HOST` names, or every interface.
    fn host(value: Option<String>) -> Result<IpAddr, SettingError> {
        let Some(value) = value else {
            return Ok(Self::DEFAULT_HOST);
        };

        value.parse().map_err(|_| SettingError::NotAnAddress {
            variable: Self::HOST,
            value,
        })
    }

    /// The data directory that `HANGAR_DATA_DIR` names, made absolute as the core does.
    fn data_dir(value: Option<String>) -> Result<DataDir, SettingError> {
        let root = Self::required(DataDir::VARIABLE, value)?;

        DataDir::new(root).map_err(|source| SettingError::DataDir { source })
    }

    /// A port, digits alone that read as 1 to 65535, as the Waku version's check: `+22` or `22 ` is no port.
    fn port(name: &'static str, value: Option<String>) -> Result<Option<u16>, SettingError> {
        let Some(value) = value else {
            return Ok(None);
        };
        let digits = value.bytes().all(|byte| byte.is_ascii_digit());
        let port = digits
            .then(|| value.parse::<u16>().ok())
            .flatten()
            .filter(|port| *port >= 1);

        match port {
            Some(port) => Ok(Some(port)),
            None => Err(SettingError::NotAPort {
                variable: name,
                value,
            }),
        }
    }

    /// The page's directory, which must hold its `index.html`: quoll refuses to serve one without, and saying so
    /// here names the variable.
    fn page(value: Option<String>) -> Result<Option<PathBuf>, SettingError> {
        let Some(dir) = value.map(PathBuf::from) else {
            return Ok(None);
        };

        if !dir.join(Self::PAGE_INDEX).is_file() {
            return Err(SettingError::NoPage { dir });
        }

        Ok(Some(dir))
    }
}

/// A value the logs never show, as a token or a key: its `Debug` says only that it is there.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    /// The value itself, for the call that sends it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(..)")
    }
}

/// What is wrong with one variable.
#[derive(Debug, thiserror::Error)]
pub enum SettingError {
    /// A variable the server needs is not set, or empty.
    #[error("{variable} is not set")]
    NotSet {
        /// The variable.
        variable: &'static str,
    },

    /// A variable that is no IP address, as `HOST=localhost`.
    #[error("{variable} must be an IP address, not {value:?}")]
    NotAnAddress {
        /// The variable.
        variable: &'static str,
        /// Its value.
        value: String,
    },

    /// `HANGAR_DATA_DIR` names no usable path.
    #[error("HANGAR_DATA_DIR is not a usable path")]
    DataDir {
        /// Why the core refuses it.
        source: StoreError,
    },

    /// A port that is not digits reading as 1 to 65535.
    #[error("{variable} must be a port number, 1 to 65535, not {value:?}")]
    NotAPort {
        /// The variable.
        variable: &'static str,
        /// Its value.
        value: String,
    },

    /// `HANGAR_PAGE_DIR` names a directory with no `index.html`.
    #[error("HANGAR_PAGE_DIR holds no index.html: {}", dir.display())]
    NoPage {
        /// The directory.
        dir: PathBuf,
    },

    /// A variable that is no `http` or `https` URL.
    #[error("{variable} must be an http or https URL, not {value:?}")]
    NotAUrl {
        /// The variable.
        variable: &'static str,
        /// Its value.
        value: String,
    },

    /// `HANGAR_URL` has a path, a query or credentials: the page is served at the root of its origin.
    #[error(
        "{variable} must be an origin, as https://hangar.example.com, with no path: not {value:?}"
    )]
    NotAnOrigin {
        /// The variable.
        variable: &'static str,
        /// Its value.
        value: String,
    },

    /// `HANGAR_SECRET` is shorter than 32 bytes.
    #[error("HANGAR_SECRET must be at least 32 bytes: `openssl rand -base64 32` prints one")]
    ShortSecret,

    /// A variable that another one set needs, as the provider's client id beside its issuer.
    #[error("{variable} is not set, which {by} needs")]
    NeededBy {
        /// The variable that is not set.
        variable: &'static str,
        /// The variable that needs it.
        by: &'static str,
    },
}

impl SettingError {
    /// The variable at fault.
    pub fn variable(&self) -> &'static str {
        match self {
            Self::NotSet { variable }
            | Self::NotAnAddress { variable, .. }
            | Self::NotAPort { variable, .. }
            | Self::NotAUrl { variable, .. }
            | Self::NotAnOrigin { variable, .. }
            | Self::NeededBy { variable, .. } => variable,
            Self::DataDir { .. } => DataDir::VARIABLE,
            Self::NoPage { .. } => Settings::PAGE_DIR,
            Self::ShortSecret => AuthSettings::SECRET,
        }
    }
}

/// The environment the server cannot start with: every variable missing or bad. It names them, and its
/// [`errors`](Self::errors) say what is wrong with each; its `source()` is the first of them.
#[derive(Debug)]
pub struct SettingsError {
    errors: Vec<SettingError>,
}

impl SettingsError {
    /// What is wrong, one error per variable, in the order they are read.
    pub fn errors(&self) -> &[SettingError] {
        &self.errors
    }
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("invalid environment: ")?;

        for (at, error) in self.errors.iter().enumerate() {
            if at > 0 {
                f.write_str(", ")?;
            }

            f.write_str(error.variable())?;
        }

        Ok(())
    }
}

impl std::error::Error for SettingsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.errors
            .first()
            .map(|error| error as &(dyn std::error::Error + 'static))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{SettingError, Settings, SettingsError};

    /// The settings of `variables`, and nothing else.
    fn read(variables: &[(&str, &str)]) -> Result<Settings, SettingsError> {
        let variables: HashMap<String, String> = variables
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect();

        Settings::read(|name| variables.get(name).cloned())
    }

    const REQUIRED: [(&str, &str); 5] = [
        ("HANGAR_DATA_DIR", "/srv/hangar"),
        ("HANGAR_STORE_URL", "https://example.com/store.git"),
        ("DOMAIN", "example.com"),
        ("HANGAR_URL", "https://hangar.example.com"),
        ("HANGAR_SECRET", "0123456789abcdef0123456789abcdef"),
    ];

    fn with_required<'a>(more: &[(&'a str, &'a str)]) -> Vec<(&'a str, &'a str)> {
        REQUIRED.iter().chain(more).copied().collect()
    }

    #[test]
    fn reads_the_required_variables_and_leaves_the_optional_ones_unset() {
        let settings = read(&REQUIRED).expect("the settings are valid");

        assert_eq!(
            settings.data_dir.root(),
            std::path::Path::new("/srv/hangar")
        );
        assert_eq!(settings.store_url, "https://example.com/store.git");
        assert_eq!(settings.domain, "example.com");
        assert!(settings.github_token.is_none());
        assert!(settings.ssh_port.is_none());
        assert!(settings.page.is_none());
    }

    #[test]
    fn names_every_missing_variable_at_once() {
        let error = read(&[("DOMAIN", "")]).expect_err("nothing required is set");

        assert_eq!(
            error.to_string(),
            "invalid environment: HANGAR_DATA_DIR, HANGAR_STORE_URL, DOMAIN, HANGAR_URL, HANGAR_SECRET"
        );
        assert_eq!(
            error
                .errors()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            [
                "HANGAR_DATA_DIR is not set",
                "HANGAR_STORE_URL is not set",
                "DOMAIN is not set",
                "HANGAR_URL is not set",
                "HANGAR_SECRET is not set"
            ]
        );
    }

    #[test]
    fn reads_the_optional_variables() {
        let settings = read(&with_required(&[
            ("GITHUB_TOKEN", "ghp_secret"),
            ("FINNHUB_API_KEY", "finnhub"),
            ("HANGAR_SSH_HOST", "host.lan"),
            ("HANGAR_SSH_USER", "root"),
            ("HANGAR_SSH_PORT", "0022"),
        ]))
        .expect("the settings are valid");

        assert_eq!(
            settings.github_token.as_ref().map(super::Secret::expose),
            Some("ghp_secret")
        );
        assert_eq!(settings.ssh_host.as_deref(), Some("host.lan"));
        assert_eq!(settings.ssh_user.as_deref(), Some("root"));
        assert_eq!(settings.ssh_port, Some(22));
    }

    #[test]
    fn refuses_a_port_that_is_not_1_to_65535() {
        for port in ["0", "65536", "+22", "22 ", "ssh", "99999999999999999999"] {
            let error = read(&with_required(&[("HANGAR_SSH_PORT", port)]))
                .expect_err("the port is refused");

            assert!(
                matches!(
                    error.errors(),
                    [SettingError::NotAPort { variable: "HANGAR_SSH_PORT", value }] if value == port
                ),
                "{port}: {error}"
            );
        }
    }

    #[test]
    fn refuses_a_page_directory_with_no_index() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let path = dir.path().to_str().expect("a UTF-8 path");

        let error = read(&with_required(&[("HANGAR_PAGE_DIR", path)]))
            .expect_err("the page has no index.html");

        assert_eq!(
            error.errors()[0].to_string(),
            format!("HANGAR_PAGE_DIR holds no index.html: {path}")
        );

        std::fs::write(dir.path().join("index.html"), "<!doctype html>").expect("written");

        let settings =
            read(&with_required(&[("HANGAR_PAGE_DIR", path)])).expect("the page is there");

        assert_eq!(settings.page.as_deref(), Some(dir.path()));
    }

    #[test]
    fn listens_where_host_and_port_say_or_as_the_image_does() {
        let default = read(&REQUIRED).expect("the settings are valid");
        let local = read(&with_required(&[("HOST", "127.0.0.1"), ("PORT", "3011")]))
            .expect("the settings are valid");
        let v6 = read(&with_required(&[("HOST", "::1")])).expect("the settings are valid");

        assert_eq!(default.address.to_string(), "0.0.0.0:3010");
        assert_eq!(local.address.to_string(), "127.0.0.1:3011");
        assert_eq!(v6.address.to_string(), "[::1]:3010");
    }

    #[test]
    fn refuses_a_host_that_is_no_ip_address_and_a_bad_port_together() {
        let error = read(&with_required(&[("HOST", "localhost"), ("PORT", "http")]))
            .expect_err("both are refused");

        assert_eq!(error.to_string(), "invalid environment: HOST, PORT");
        assert_eq!(
            error.errors()[0].to_string(),
            "HOST must be an IP address, not \"localhost\""
        );
    }

    #[test]
    fn gives_the_first_error_as_its_source() {
        let error = read(&[]).expect_err("nothing required is set");
        let source = std::error::Error::source(&error).expect("a source");

        assert_eq!(source.to_string(), "HANGAR_DATA_DIR is not set");
    }

    #[test]
    fn keeps_the_secrets_out_of_debug() {
        let settings = read(&with_required(&[
            ("GITHUB_TOKEN", "ghp_secret"),
            ("HANGAR_OIDC_ISSUER", "https://auth.example.com"),
            ("HANGAR_OIDC_CLIENT_ID", "hangar"),
            ("HANGAR_OIDC_CLIENT_SECRET", "oidc_secret"),
        ]))
        .expect("the settings are valid");
        let debug = format!("{settings:?}");

        assert!(!debug.contains("ghp_secret"));
        assert!(!debug.contains("oidc_secret"));
        assert!(!debug.contains("0123456789abcdef"));
    }
}
