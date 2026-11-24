//! Where the daemon listens, as `DOCKER_HOST` says it, and the client that reaches it there.

use std::ffi::OsStr;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use quoll::client;

use super::DockerError;
use super::engine::{Engine, EngineClient};

/// Docker's own socket, where `DOCKER_HOST` names none.
const DEFAULT_SOCKET: &str = "/var/run/docker.sock";

/// The longest label of a DNS name.
const MAX_LABEL: usize = 63;

/// The port of a daemon on TCP without TLS, where `DOCKER_HOST` names none.
const DEFAULT_PORT: u16 = 2375;

/// The deadline of a call, for the head of the answer alone on a stream: a daemon that hangs fails a read rather
/// than holding it forever, and a followed log or the events are not cut.
const DEADLINE: Duration = Duration::from_secs(30);

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
        let docker_host = std::env::var_os("DOCKER_HOST");
        let tls_verify = std::env::var_os("DOCKER_TLS_VERIFY");
        let docker_host = match docker_host.as_deref().map(OsStr::to_str) {
            None => None,
            Some(Some(docker_host)) => Some(docker_host),
            Some(None) => {
                return Err(DockerError::UnsupportedHost {
                    docker_host: docker_host
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    reason: "which is not UTF-8: write `unix:///path` or `tcp://host:port`",
                });
            }
        };

        Self::parse(docker_host)?.refuse_tls(tls_verify.as_deref())
    }

    /// The host, unless `tls_verify`, the value of `DOCKER_TLS_VERIFY`, asks for TLS on TCP: that needs the client's
    /// certificate, which Hangar does not send, and is better said than a failed call. A Unix socket has no TLS,
    /// and the variable means nothing there, as for the `docker` command.
    fn refuse_tls(self, tls_verify: Option<&OsStr>) -> Result<Self, DockerError> {
        let asks_tls = tls_verify.is_some_and(|value| !value.is_empty());

        if asks_tls && matches!(self, Self::Tcp(_)) {
            return Err(DockerError::UnsupportedTls);
        }

        Ok(self)
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
        let (host, port) = match address.rsplit_once(':') {
            Some((host, port)) if !port.contains(']') => (host, Some(port)),
            _ => (address, None),
        };
        let is_port = port.is_none_or(|port| {
            port.bytes().all(|byte| byte.is_ascii_digit())
                && port.parse::<u16>().is_ok_and(|port| port != 0)
        });

        if host.starts_with('[') && host.contains('%') {
            return Err(unsupported(
                "whose IPv6 address has a zone id, which Hangar does not support: write the address without its `%...`",
            ));
        }

        if !Self::is_host(host) || !is_port {
            return Err(unsupported(
                "whose host or port does not read: write `tcp://host:port`, with a port from 1 to 65535",
            ));
        }

        let url = match port {
            Some(port) => format!("http://{host}:{port}"),
            None => format!("http://{host}:{DEFAULT_PORT}"),
        };

        Ok(Self::Tcp(url))
    }

    /// Whether `host` names a host and nothing more, no path, user or query: an IPv4 address when it is digits and
    /// dots alone, a DNS name otherwise, or an IPv6 address within brackets, which alone tell its `:` from the port's.
    fn is_host(host: &str) -> bool {
        if let Some(address) = host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
        {
            return address.parse::<Ipv6Addr>().is_ok();
        }

        if host
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        {
            return host.parse::<Ipv4Addr>().is_ok();
        }

        host.split('.').all(Self::is_label)
    }

    /// Whether `label` is a label of a DNS name: letters, digits, `-` and `_`, neither starting nor ending with `-`.
    fn is_label(label: &str) -> bool {
        let is_spelled = label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));

        (1..=MAX_LABEL).contains(&label.len())
            && is_spelled
            && !label.starts_with('-')
            && !label.ends_with('-')
    }

    /// A client of the daemon.
    pub(crate) fn client(&self) -> Result<EngineClient, DockerError> {
        let builder = client::builder()
            .with(client::user_agent(USER_AGENT))
            .with(client::timeout(DEADLINE));
        match self {
            Self::Tcp(url) => {
                builder
                    .build::<Engine>(url)
                    .map_err(|_| DockerError::UnsupportedHost {
                        docker_host: url.clone(),
                        reason: "which does not make a URL: write `tcp://host:port`",
                    })
            }
            Self::Unix(path) => Self::over_socket(builder, path)?
                .map_err(|error| DockerError::daemon("build the Docker client", error)),
        }
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
    fn refuses_tls_on_tcp_alone() {
        let tcp = || parsed(Some("tcp://docker:2376"));
        let socket = || parsed(None);

        let set = |value: &'static str| Some(OsStr::new(value));

        assert!(matches!(
            tcp().refuse_tls(set("1")),
            Err(DockerError::UnsupportedTls)
        ));
        assert_eq!(tcp().refuse_tls(set("")).ok(), Some(tcp()));
        assert_eq!(tcp().refuse_tls(None).ok(), Some(tcp()));
        assert_eq!(socket().refuse_tls(set("1")).ok(), Some(socket()));
    }

    #[test]
    fn takes_a_dns_name_or_an_ip_address() {
        assert_eq!(
            parsed(Some("tcp://my_docker.lan:2375")),
            Host::Tcp("http://my_docker.lan:2375".into())
        );
        assert_eq!(
            parsed(Some("tcp://10.0.0.2")),
            Host::Tcp("http://10.0.0.2:2375".into())
        );
        assert_eq!(
            parsed(Some("tcp://[fe80::1]:2375")),
            Host::Tcp("http://[fe80::1]:2375".into())
        );
    }

    #[test]
    fn says_that_a_zone_id_is_not_supported() {
        let error = Host::parse(Some("tcp://[fe80::1%eth0]:2375")).expect_err("a zone id");

        assert!(error.to_string().contains("zone id"), "{error}");
    }

    #[test]
    fn another_host_says_what_to_write() {
        for docker_host in [
            "tcp://docker:",
            "tcp://docker:abc",
            "tcp://docker:0",
            "tcp://docker:70000",
            "tcp://docker:+80",
            "tcp://::1",
            "tcp://::1:2375",
            "tcp://[abc:2375",
            "tcp://[]:2375",
            "tcp://[abc",
            "tcp://abc]",
            "tcp://[[::1]]:2375",
            "tcp://[zzz]:2375",
            "tcp://docker/x",
            "tcp://me@docker:2375",
            "tcp://docker?x=1",
            "tcp://docker#x",
            "tcp://doc ker:2375",
            "tcp://999.1.1.1:2375",
            "tcp://-:2375",
            "tcp://.:2375",
            "tcp://a..b:2375",
            "tcp://-docker:2375",
            "tcp://docker-:2375",
            "tcp://:2375",
            "tcp://[::1]:",
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
