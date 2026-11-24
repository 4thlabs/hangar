//! Where the daemon listens, as `DOCKER_HOST` says it, and the client that reaches it there.

use std::path::{Path, PathBuf};

use quoll::client;

use super::DockerError;
use super::engine::{Engine, EngineClient};

/// Docker's own socket, where `DOCKER_HOST` names none.
const DEFAULT_SOCKET: &str = "/var/run/docker.sock";

/// The port of a daemon on TCP without TLS, where `DOCKER_HOST` names none.
const DEFAULT_PORT: u16 = 2375;

/// The `User-Agent` of Hangar's calls.
const USER_AGENT: &str = concat!("hangar/", env!("CARGO_PKG_VERSION"));

/// Where the daemon listens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Host {
    /// A Unix socket.
    Unix(PathBuf),
    /// The URL of a daemon on TCP.
    Tcp(String),
}

impl Host {
    /// The daemon that `DOCKER_HOST` names, else Docker's own socket.
    pub(crate) fn from_env() -> Result<Self, DockerError> {
        // TLS would need the client's certificate, which Hangar does not send: better said than a failed call.
        if std::env::var_os("DOCKER_TLS_VERIFY").is_some_and(|value| !value.is_empty()) {
            return Err(DockerError::UnsupportedTls);
        }

        Self::parse(std::env::var("DOCKER_HOST").ok().as_deref())
    }

    /// The daemon `docker_host` names, as `DOCKER_HOST` is written: `unix:///path`, `tcp://host:port`, or nothing.
    pub(crate) fn parse(docker_host: Option<&str>) -> Result<Self, DockerError> {
        let Some(value) = docker_host.filter(|value| !value.is_empty()) else {
            return Ok(Self::Unix(DEFAULT_SOCKET.into()));
        };
        let unsupported = |reason| DockerError::UnsupportedHost {
            docker_host: value.to_owned(),
            reason,
        };

        if let Some(path) = value.strip_prefix("unix://") {
            if path.is_empty() {
                return Err(unsupported(
                    "which names no socket: write `unix:///path/to/docker.sock`",
                ));
            }

            return Ok(Self::Unix(path.into()));
        }

        let Some(address) = value.strip_prefix("tcp://") else {
            return Err(unsupported(
                "which Hangar does not reach: write `unix:///path` or `tcp://host:port`",
            ));
        };
        let address = address.trim_end_matches('/');

        if address.is_empty() {
            return Err(unsupported("which names no host: write `tcp://host:port`"));
        }

        // An IPv6 address holds `:` too, but within its brackets.
        let has_port = address
            .rsplit_once(':')
            .is_some_and(|(_, port)| !port.contains(']'));
        let url = if has_port {
            format!("http://{address}")
        } else {
            format!("http://{address}:{DEFAULT_PORT}")
        };

        Ok(Self::Tcp(url))
    }

    /// A client of the daemon.
    pub(crate) fn client(&self) -> Result<EngineClient, DockerError> {
        let builder = client::builder().with(client::user_agent(USER_AGENT));
        let built = match self {
            Self::Tcp(url) => builder.build::<Engine>(url),
            Self::Unix(path) => Self::over_socket(builder, path)?,
        };

        built.map_err(|error| DockerError::daemon("build the Docker client", error))
    }

    #[cfg(unix)]
    fn over_socket(
        builder: client::Builder,
        path: &Path,
    ) -> Result<quoll::Result<EngineClient>, DockerError> {
        let path = path.to_owned();

        // Over the socket, the URL's host is only the request's `Host`, which Docker does not read.
        Ok(builder
            .http(move |http| http.unix_socket(path))
            .build::<Engine>("http://localhost"))
    }

    #[cfg(not(unix))]
    fn over_socket(
        _: client::Builder,
        path: &Path,
    ) -> Result<quoll::Result<EngineClient>, DockerError> {
        Err(DockerError::UnsupportedHost {
            docker_host: format!("unix://{}", path.display()),
            reason: "which needs a Unix system: write `tcp://host:port`",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(docker_host: Option<&str>) -> Host {
        Host::parse(docker_host).expect("a host")
    }

    #[test]
    fn no_host_is_dockers_own_socket() {
        assert_eq!(parsed(None), Host::Unix("/var/run/docker.sock".into()));
        assert_eq!(parsed(Some("")), Host::Unix("/var/run/docker.sock".into()));
    }

    #[test]
    fn a_unix_host_is_its_socket() {
        assert_eq!(
            parsed(Some("unix:///run/user/1000/docker.sock")),
            Host::Unix("/run/user/1000/docker.sock".into())
        );
    }

    #[test]
    fn a_tcp_host_is_an_http_url_on_2375_unless_it_names_its_port() {
        assert_eq!(
            parsed(Some("tcp://127.0.0.1:2376/")),
            Host::Tcp("http://127.0.0.1:2376".into())
        );
        assert_eq!(
            parsed(Some("tcp://docker")),
            Host::Tcp("http://docker:2375".into())
        );
        assert_eq!(
            parsed(Some("tcp://[::1]")),
            Host::Tcp("http://[::1]:2375".into())
        );
        assert_eq!(
            parsed(Some("tcp://[::1]:2380")),
            Host::Tcp("http://[::1]:2380".into())
        );
    }

    #[test]
    fn another_host_says_what_to_write() {
        for docker_host in [
            "ssh://me@host",
            "npipe:////./pipe/docker_engine",
            "unix://",
            "tcp://",
        ] {
            let error = Host::parse(Some(docker_host)).expect_err("not a host");

            assert!(error.to_string().contains("write"), "{error}");
        }
    }
}
