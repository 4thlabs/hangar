//! What the registries serve for the images the installed apps run, asked through the daemon so that its credentials
//! apply, and the apps that run an image the registry has moved past.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use super::engine::{EngineMessage, Images as _};
use super::{Docker, RunningImage};

/// How long a registry has to answer for one reference: one that does not answer is left out, and the others are
/// asked all the same.
const REGISTRY_DEADLINE: Duration = Duration::from_secs(10);

/// The status of an answer that refuses a call for asking too often.
const TOO_MANY_REQUESTS: u16 = 429;

/// What a registry served for each reference when it was asked, by the reference as compose runs it, such as
/// `nginx:alpine`: the digest of its manifest, `sha256:...`. A reference it was not asked for, or did not answer for,
/// is not in it: whether an app that runs it is behind is not known.
///
/// ```
/// use hangar_core::{RegistryDigests, RunningImage};
///
/// let registry: RegistryDigests = [("nginx:alpine".to_owned(), "sha256:new".to_owned())].into_iter().collect();
/// let running = RunningImage {
///     project: "alpha".to_owned(),
///     image: "nginx:alpine".to_owned(),
///     digests: vec!["nginx@sha256:old".to_owned()],
/// };
///
/// assert!(registry.outdated(&[running]).contains("alpha"));
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegistryDigests {
    by_reference: BTreeMap<String, String>,
}

/// What a registry answered for one reference.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Answer {
    /// The digest it serves.
    Digest(String),
    /// No digest: the registry could not be reached, did not answer in time, or refused a private image.
    Unknown,
    /// It refused the call for asking too often: it refuses the next ones too.
    RateLimited,
}

impl RegistryDigests {
    /// The digest the registry served for `reference`, when it was asked and answered.
    pub fn get(&self, reference: &str) -> Option<&str> {
        self.by_reference.get(reference).map(String::as_str)
    }

    /// How many references it holds a digest of.
    pub fn len(&self) -> usize {
        self.by_reference.len()
    }

    /// Whether it holds no digest.
    pub fn is_empty(&self) -> bool {
        self.by_reference.is_empty()
    }

    /// The projects of `running` that run an image the registry has moved past: by the digests of the image each
    /// container was created from, never by its reference, which a pull moves before the container is recreated. A
    /// container counts only when its image's digests and the registry's answer are both known.
    pub fn outdated(&self, running: &[RunningImage]) -> BTreeSet<String> {
        running
            .iter()
            .filter(|container| {
                let Some(served) = self.get(&container.image) else {
                    return false;
                };
                let runs_it = container.digests.iter().any(|digest| {
                    digest
                        .rsplit_once('@')
                        .is_some_and(|(_, local)| local == served)
                });

                !container.digests.is_empty() && !runs_it
            })
            .map(|container| container.project.clone())
            .collect()
    }
}

impl FromIterator<(String, String)> for RegistryDigests {
    /// The digests of `(reference, digest)` pairs.
    fn from_iter<I: IntoIterator<Item = (String, String)>>(pairs: I) -> Self {
        Self {
            by_reference: pairs.into_iter().collect(),
        }
    }
}

impl Docker {
    /// Asks the registries, through the daemon so that its credentials apply, what they serve for each reference that
    /// `running` names, once each, one at a time, `spacing` apart: the calls count against a registry's rate limit.
    /// A reference pinned to a digest, as `nginx@sha256:...`, or an image built on the host, which has no registry
    /// digest, is not asked. A registry has 10 seconds to answer; one that does not, or fails, is left out, and the
    /// first that refuses the call for asking too often, a 429, stops the check: the references after it are left out
    /// too, until the next.
    pub async fn registry_digests(
        &self,
        running: &[RunningImage],
        spacing: Duration,
    ) -> RegistryDigests {
        self.registry_digests_within(running, spacing, REGISTRY_DEADLINE)
            .await
    }

    /// [`registry_digests`](Self::registry_digests), each registry given `deadline` to answer.
    async fn registry_digests_within(
        &self,
        running: &[RunningImage],
        spacing: Duration,
        deadline: Duration,
    ) -> RegistryDigests {
        let references = Self::checked_references(running);
        let mut digests = RegistryDigests::default();

        for (index, reference) in references.iter().enumerate() {
            if index > 0 {
                tokio::time::sleep(spacing).await;
            }

            match self.registry_digest(reference, deadline).await {
                Answer::Digest(digest) => {
                    digests.by_reference.insert((*reference).to_owned(), digest);
                }
                Answer::Unknown => {}
                Answer::RateLimited => {
                    tracing::warn!(
                        reference,
                        checked = index,
                        skipped = references.len() - index - 1,
                        "a registry refused the image check for asking too often: the images after it are checked \
                         next time"
                    );

                    break;
                }
            }
        }

        digests
    }

    /// The references of `running` a registry can say something of, once each, in order: not those pinned to a
    /// digest, nor the images built on the host.
    fn checked_references(running: &[RunningImage]) -> Vec<&str> {
        let mut references: Vec<&str> = Vec::new();

        for container in running {
            let is_pinned =
                container.image.contains("@sha256:") || container.image.starts_with("sha256:");
            let is_built_here = container.digests.is_empty();
            let is_listed = references.contains(&container.image.as_str());

            if !is_pinned && !is_built_here && !is_listed {
                references.push(&container.image);
            }
        }

        references
    }

    /// What the registry of `reference` answers within `deadline`.
    async fn registry_digest(&self, reference: &str, deadline: Duration) -> Answer {
        let images = self.engine.images();

        match tokio::time::timeout(deadline, images.distribution(reference)).await {
            Ok(Ok(inspection)) => Answer::Digest(inspection.descriptor.digest),
            Ok(Err(error)) if Self::is_rate_limited(&error) => Answer::RateLimited,
            Ok(Err(error)) => {
                tracing::warn!(reference, %error, "could not check an image for an update");

                Answer::Unknown
            }
            Err(_) => {
                tracing::warn!(
                    reference,
                    seconds = deadline.as_secs_f64(),
                    "could not check an image for an update: its registry did not answer in time"
                );

                Answer::Unknown
            }
        }
    }

    /// Whether the daemon says the registry refused the call for asking too often: its own 429, or the registry's
    /// `toomanyrequests` in its message, which it may answer with another status.
    fn is_rate_limited(error: &quoll::Error<EngineMessage>) -> bool {
        let is_429 = error
            .status()
            .is_some_and(|status| status.as_u16() == TOO_MANY_REQUESTS);
        let says_so = error.detail().is_some_and(|detail| {
            let message = detail.message.to_ascii_lowercase();

            message.contains("toomanyrequests") || message.contains("too many requests")
        });

        is_429 || says_so
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::*;

    /// How a fake daemon answers for a reference.
    #[derive(Debug, Clone, Copy)]
    enum Reply {
        /// The registry serves this digest.
        Digest(&'static str),
        /// The daemon answers this status, with this message.
        Fails(u16, &'static str),
        /// The daemon never answers.
        Silent,
    }

    /// A daemon on port 0 that answers `GET /v1.44/distribution/{reference}/json` as it was told, and keeps the
    /// references asked, in order.
    struct FakeDaemon {
        docker: Docker,
        asked: Arc<Mutex<Vec<String>>>,
        task: tokio::task::JoinHandle<()>,
    }

    impl FakeDaemon {
        async fn serve(replies: &[(&str, Reply)]) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("a listener");
            let port = listener.local_addr().expect("its address").port();
            let replies: Arc<HashMap<String, Reply>> = Arc::new(
                replies
                    .iter()
                    .map(|(reference, reply)| ((*reference).to_owned(), *reply))
                    .collect(),
            );
            let asked = Arc::new(Mutex::new(Vec::new()));
            let recorded = Arc::clone(&asked);
            let task = tokio::spawn(async move {
                while let Ok((connection, _)) = listener.accept().await {
                    tokio::spawn(Self::answer(
                        connection,
                        Arc::clone(&replies),
                        Arc::clone(&recorded),
                    ));
                }
            });

            Self {
                docker: Docker::with_host(&format!("tcp://127.0.0.1:{port}")).expect("a client"),
                asked,
                task,
            }
        }

        /// Answers the one request of `connection`, then closes it.
        async fn answer(
            mut connection: TcpStream,
            replies: Arc<HashMap<String, Reply>>,
            asked: Arc<Mutex<Vec<String>>>,
        ) {
            let mut head = Vec::new();
            let mut buffer = [0; 1024];

            while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                match connection.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(read) => head.extend_from_slice(&buffer[..read]),
                }
            }

            let head = String::from_utf8_lossy(&head);
            let path = head.split(' ').nth(1).unwrap_or_default();
            let reference = Self::decode(
                path.strip_prefix("/v1.44/distribution/")
                    .and_then(|rest| rest.strip_suffix("/json"))
                    .unwrap_or_default(),
            );

            asked
                .lock()
                .expect("no test panics with the lock")
                .push(reference.clone());

            let (status, body) = match replies.get(&reference) {
                Some(Reply::Digest(digest)) => (
                    200,
                    serde_json::json!({ "Descriptor": { "digest": digest } }),
                ),
                Some(Reply::Fails(status, message)) => {
                    (*status, serde_json::json!({ "message": message }))
                }
                Some(Reply::Silent) => return std::future::pending().await,
                None => (404, serde_json::json!({ "message": "no such image" })),
            };
            let body = body.to_string();
            let answer = format!(
                "HTTP/1.1 {status} Answer\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
                 Connection: close\r\n\r\n{body}",
                body.len()
            );

            let _ = connection.write_all(answer.as_bytes()).await;
        }

        /// A path segment as it was before quoll escaped it.
        fn decode(segment: &str) -> String {
            let bytes = segment.as_bytes();
            let mut decoded = Vec::new();
            let mut index = 0;

            while index < bytes.len() {
                let escaped = (bytes[index] == b'%')
                    .then(|| segment.get(index + 1..index + 3))
                    .flatten()
                    .and_then(|hex| u8::from_str_radix(hex, 16).ok());

                match escaped {
                    Some(byte) => {
                        decoded.push(byte);
                        index += 3;
                    }
                    None => {
                        decoded.push(bytes[index]);
                        index += 1;
                    }
                }
            }

            String::from_utf8(decoded).expect("a UTF-8 reference")
        }

        fn asked(&self) -> Vec<String> {
            self.asked
                .lock()
                .expect("no test panics with the lock")
                .clone()
        }
    }

    impl Drop for FakeDaemon {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    /// A container of `project` that runs `image`, created from an image of `digests`.
    fn running(project: &str, image: &str, digests: &[&str]) -> RunningImage {
        RunningImage {
            project: project.to_owned(),
            image: image.to_owned(),
            digests: digests.iter().map(|digest| (*digest).to_owned()).collect(),
        }
    }

    fn digests(pairs: &[(&str, &str)]) -> RegistryDigests {
        pairs
            .iter()
            .map(|(reference, digest)| ((*reference).to_owned(), (*digest).to_owned()))
            .collect()
    }

    #[tokio::test]
    async fn asks_each_reference_once_and_tells_the_apps_whose_image_the_registry_moved_past() {
        let daemon = FakeDaemon::serve(&[
            ("nginx:alpine", Reply::Digest("sha256:new")),
            ("ghcr.io/acme/api:2", Reply::Digest("sha256:same")),
        ])
        .await;
        let running = [
            running("alpha", "nginx:alpine", &["nginx@sha256:old"]),
            running("beta", "nginx:alpine", &["nginx@sha256:old"]),
            running(
                "gamma",
                "ghcr.io/acme/api:2",
                &["ghcr.io/acme/api@sha256:same"],
            ),
        ];

        let served = daemon
            .docker
            .registry_digests(&running, Duration::ZERO)
            .await;

        assert_eq!(daemon.asked(), ["nginx:alpine", "ghcr.io/acme/api:2"]);
        assert_eq!(
            served,
            digests(&[
                ("nginx:alpine", "sha256:new"),
                ("ghcr.io/acme/api:2", "sha256:same")
            ])
        );
        assert_eq!(
            served.outdated(&running),
            BTreeSet::from(["alpha".to_owned(), "beta".to_owned()])
        );
    }

    #[tokio::test]
    async fn skips_the_pinned_references_and_the_images_built_on_the_host() {
        let daemon = FakeDaemon::serve(&[("redis:7", Reply::Digest("sha256:redis"))]).await;
        let running = [
            running("alpha", "nginx@sha256:abc", &["nginx@sha256:abc"]),
            running("beta", "sha256:0123", &["nginx@sha256:0123"]),
            running("gamma", "acme/app:dev", &[]),
            running("delta", "redis:7", &["redis@sha256:redis"]),
        ];

        let served = daemon
            .docker
            .registry_digests(&running, Duration::ZERO)
            .await;

        assert_eq!(daemon.asked(), ["redis:7"]);
        assert_eq!(served, digests(&[("redis:7", "sha256:redis")]));
    }

    #[tokio::test]
    async fn stops_at_the_first_answer_that_refuses_it_for_asking_too_often() {
        let daemon = FakeDaemon::serve(&[
            ("alpha:1", Reply::Digest("sha256:alpha")),
            ("beta:1", Reply::Fails(429, "too many requests")),
            ("gamma:1", Reply::Digest("sha256:gamma")),
        ])
        .await;
        let running = [
            running("alpha", "alpha:1", &["alpha@sha256:alpha"]),
            running("beta", "beta:1", &["beta@sha256:beta"]),
            running("gamma", "gamma:1", &["gamma@sha256:old"]),
        ];

        let served = daemon
            .docker
            .registry_digests(&running, Duration::ZERO)
            .await;

        assert_eq!(daemon.asked(), ["alpha:1", "beta:1"]);
        assert_eq!(served, digests(&[("alpha:1", "sha256:alpha")]));
    }

    #[tokio::test]
    async fn stops_when_the_daemon_says_the_registry_refused_it_for_asking_too_often() {
        let refused = "toomanyrequests: You have reached your pull rate limit";
        let daemon = FakeDaemon::serve(&[
            ("alpha:1", Reply::Fails(500, refused)),
            ("beta:1", Reply::Digest("sha256:beta")),
        ])
        .await;
        let running = [
            running("alpha", "alpha:1", &["alpha@sha256:alpha"]),
            running("beta", "beta:1", &["beta@sha256:beta"]),
        ];

        let served = daemon
            .docker
            .registry_digests(&running, Duration::ZERO)
            .await;

        assert_eq!(daemon.asked(), ["alpha:1"]);
        assert!(served.is_empty());
    }

    #[tokio::test]
    async fn leaves_out_a_reference_whose_registry_fails_or_does_not_answer_in_time() {
        let daemon = FakeDaemon::serve(&[
            ("alpha:1", Reply::Silent),
            (
                "beta:1",
                Reply::Fails(403, "denied: requested access to the resource is denied"),
            ),
            ("gamma:1", Reply::Digest("sha256:gamma")),
        ])
        .await;
        let running = [
            running("alpha", "alpha:1", &["alpha@sha256:alpha"]),
            running("beta", "beta:1", &["beta@sha256:beta"]),
            running("gamma", "gamma:1", &["gamma@sha256:gamma"]),
        ];

        let served = daemon
            .docker
            .registry_digests_within(&running, Duration::ZERO, Duration::from_millis(200))
            .await;

        assert_eq!(daemon.asked(), ["alpha:1", "beta:1", "gamma:1"]);
        assert_eq!(served, digests(&[("gamma:1", "sha256:gamma")]));
    }

    #[tokio::test]
    async fn spaces_its_calls() {
        let daemon = FakeDaemon::serve(&[
            ("alpha:1", Reply::Digest("sha256:alpha")),
            ("beta:1", Reply::Digest("sha256:beta")),
            ("gamma:1", Reply::Digest("sha256:gamma")),
        ])
        .await;
        let running = [
            running("alpha", "alpha:1", &["alpha@sha256:alpha"]),
            running("beta", "beta:1", &["beta@sha256:beta"]),
            running("gamma", "gamma:1", &["gamma@sha256:gamma"]),
        ];
        let started = Instant::now();

        daemon
            .docker
            .registry_digests(&running, Duration::from_millis(150))
            .await;

        assert!(started.elapsed() >= Duration::from_millis(300));
    }

    #[test]
    fn calls_outdated_only_an_app_whose_image_and_registry_answer_are_both_known() {
        let served = digests(&[("nginx:alpine", "sha256:new")]);
        let running = [
            running(
                "alpha",
                "nginx:alpine",
                &["nginx@sha256:old", "mirror/nginx@sha256:new"],
            ),
            running("beta", "nginx:alpine", &[]),
            running("gamma", "redis:7", &["redis@sha256:old"]),
            running("delta", "nginx:alpine", &["nginx@sha256:old"]),
        ];

        assert_eq!(
            served.outdated(&running),
            BTreeSet::from(["delta".to_owned()])
        );
    }
}
