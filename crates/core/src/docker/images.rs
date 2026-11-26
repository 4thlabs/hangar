//! The images on the host, by their registry digests, and the images that the containers of the compose projects run.

use std::collections::HashMap;

use super::engine::{ImageSummary, Images as _, SystemInfo, Usage as _};
use super::{ComposeContainers, Docker, DockerError};

/// The registry digests of the images on the host, by image id: what a registry served for each, which a check for a
/// newer image compares with what the registry serves now.
///
/// Docker keeps its images in one of two stores, which give them apart. On the classic one, an image's id is the
/// digest of its config: a pulled image keeps the digest of its manifest, `nginx@sha256:...`, even once its reference
/// names a newer one, and an image built on the host has none. On containerd's, Docker 29's default, an image's id is
/// the digest of what was pulled, which its registry digest names too, and an image built on the host has one of its
/// own id alike; an image pulled whose reference names a newer one has none left. The daemon says which it keeps.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImageDigests {
    by_id: HashMap<String, Vec<String>>,
    /// Whether the daemon keeps its images in containerd's store.
    is_containerd: bool,
}

/// The image a container of an installed compose project runs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RunningImage {
    /// The project of the container.
    pub project: String,
    /// The compose service of the container.
    pub service: String,
    /// The image as compose runs it, such as `nginx:alpine`, as the container was created with it.
    pub image: String,
    /// The id of the image the container was created from, `sha256:...`: on containerd's store, the digest of what was
    /// pulled.
    pub image_id: String,
    /// The registry digests of the image the container was created from, each `name@sha256:...`; none for an image
    /// built on the host on the classic store, for one pulled whose reference names a newer one on containerd's, or for
    /// one the host no longer has.
    pub digests: Vec<String>,
    /// Whether the image was built on the host, which no registry serves: one of a service whose compose file builds
    /// it, and, on the classic store, one with no registry digest. On containerd's, an image built on the host has a
    /// registry digest as a pulled one does: only its compose file tells it.
    pub is_built_here: bool,
}

impl ImageDigests {
    /// What the storage driver's `driver-type` is with containerd's image store.
    const CONTAINERD_SNAPSHOTTER: &str = "io.containerd.snapshotter.v1";

    /// Whether the daemon of `info` keeps its images in containerd's store.
    fn is_containerd(info: &SystemInfo) -> bool {
        info.driver_status.iter().any(|pair| {
            matches!(pair.as_slice(), [name, value] if name == "driver-type" && value == Self::CONTAINERD_SNAPSHOTTER)
        })
    }

    /// The digests of the images that the daemon lists, kept in containerd's store when `is_containerd`.
    fn new(images: Vec<ImageSummary>, is_containerd: bool) -> Self {
        Self {
            by_id: images
                .into_iter()
                .map(|image| (image.id, image.repo_digests))
                .collect(),
            is_containerd,
        }
    }

    /// The registry digests of the image `image_id`, `sha256:...`; none for an image built on the host, or one the
    /// host does not have.
    pub fn get(&self, image_id: &str) -> &[String] {
        self.by_id.get(image_id).map_or(&[], Vec::as_slice)
    }
}

impl ComposeContainers {
    /// The images the containers of the `installed` projects run, each given with the services its compose file
    /// builds, by the image each container was created from, never by its reference: `docker compose pull` moves the
    /// reference and leaves the containers on their image until they are recreated, so the reference would call an app
    /// up to date while it still runs the old image.
    pub fn running_images<'a>(
        &self,
        installed: impl IntoIterator<Item = (&'a str, &'a [String])>,
        digests: &ImageDigests,
    ) -> Vec<RunningImage> {
        let installed: Vec<(&str, &[String])> = installed.into_iter().collect();

        self.as_slice()
            .iter()
            .filter_map(|container| {
                let (_, built) = installed
                    .iter()
                    .find(|(project, _)| *project == container.project)?;
                let image_digests = digests.get(&container.image_id).to_vec();
                let has_no_registry_digest = image_digests.is_empty() && !digests.is_containerd;

                Some(RunningImage {
                    project: container.project.clone(),
                    service: container.service.clone(),
                    image: container.image.clone(),
                    image_id: container.image_id.clone(),
                    is_built_here: built.contains(&container.service) || has_no_registry_digest,
                    digests: image_digests,
                })
            })
            .collect()
    }
}

impl Docker {
    /// The registry digests of every image on the host, by image id, and the store the daemon keeps them in, from
    /// its info.
    ///
    /// # Errors
    ///
    /// [`DockerError::Daemon`] when the daemon cannot list its images, or say its info.
    pub async fn image_digests(&self) -> Result<ImageDigests, DockerError> {
        let images = self.engine.images();
        let usage = self.engine.usage();
        let (listed, info) = tokio::join!(images.list(), usage.info());
        let listed = listed.map_err(|error| DockerError::daemon("list the images", error))?;
        let info = info.map_err(|error| DockerError::daemon("read the daemon's info", error))?;

        Ok(ImageDigests::new(
            listed,
            ImageDigests::is_containerd(&info),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::super::{ComposeContainer, ContainerState};
    use super::*;

    fn container(project: &str, image_id: &str) -> ComposeContainer {
        ComposeContainer {
            id: format!("{project}-1"),
            name: format!("{project}-web-1"),
            project: project.to_owned(),
            service: "web".to_owned(),
            replica: Some(1),
            image: "nginx:alpine".to_owned(),
            image_id: image_id.to_owned(),
            state: ContainerState::Running,
            details: None,
            listed_health: None,
            ports: Vec::new(),
        }
    }

    fn image(id: &str, repo_digests: &[&str]) -> ImageSummary {
        ImageSummary {
            id: id.to_owned(),
            repo_digests: repo_digests
                .iter()
                .map(|digest| (*digest).to_owned())
                .collect(),
        }
    }

    /// The installed `projects`, none of whose services its compose file builds.
    fn pulled<'a>(projects: &[&'a str]) -> Vec<(&'a str, &'a [String])> {
        projects.iter().map(|project| (*project, &[][..])).collect()
    }

    #[test]
    fn gives_the_digests_of_the_image_each_container_of_an_installed_project_was_created_from() {
        let digests = ImageDigests::new(
            vec![
                image("sha256:old", &["nginx@sha256:1"]),
                image("sha256:new", &["nginx@sha256:2"]),
            ],
            false,
        );
        let containers = ComposeContainers::new(vec![
            container("alpha", "sha256:old"),
            container("beta", "sha256:new"),
            container("gamma", "sha256:built-here"),
        ]);

        assert_eq!(
            containers.running_images(pulled(&["alpha", "gamma"]), &digests),
            [
                RunningImage {
                    project: "alpha".to_owned(),
                    service: "web".to_owned(),
                    image: "nginx:alpine".to_owned(),
                    image_id: "sha256:old".to_owned(),
                    digests: vec!["nginx@sha256:1".to_owned()],
                    is_built_here: false,
                },
                RunningImage {
                    project: "gamma".to_owned(),
                    service: "web".to_owned(),
                    image: "nginx:alpine".to_owned(),
                    image_id: "sha256:built-here".to_owned(),
                    digests: Vec::new(),
                    is_built_here: true,
                },
            ]
        );
    }

    #[test]
    fn calls_an_image_of_no_registry_digest_built_here_on_the_classic_store_alone() {
        let containers = ComposeContainers::new(vec![container("alpha", "sha256:old")]);
        // `sha256:old`, with no registry digest: built here on the classic store; on containerd's, pulled, it lost its
        // own once its reference named a newer image.
        let images = || vec![image("sha256:old", &[])];
        let classic = ImageDigests::new(images(), false);
        let containerd = ImageDigests::new(images(), true);

        assert!(containers.running_images(pulled(&["alpha"]), &classic)[0].is_built_here);
        assert!(!containers.running_images(pulled(&["alpha"]), &containerd)[0].is_built_here);
    }

    #[test]
    fn calls_the_image_of_a_service_its_compose_file_builds_built_here_on_either_store() {
        let containers = ComposeContainers::new(vec![container("alpha", "sha256:built")]);
        let built = ["web".to_owned()];
        // On containerd's store, a build has a registry digest of its own id, as a pulled image does.
        let images = || vec![image("sha256:built", &["alpha-web@sha256:built"])];

        for is_containerd in [false, true] {
            let digests = ImageDigests::new(images(), is_containerd);
            let running = containers.running_images([("alpha", &built[..])], &digests);

            assert!(running[0].is_built_here, "containerd: {is_containerd}");
        }
    }

    #[test]
    fn tells_containerd_s_store_by_the_driver_the_daemon_says_it_runs() {
        let info = |status: serde_json::Value| -> SystemInfo {
            serde_json::from_value(serde_json::json!({ "DriverStatus": status })).expect("an info")
        };

        assert!(ImageDigests::is_containerd(&info(serde_json::json!([[
            "driver-type",
            "io.containerd.snapshotter.v1"
        ]]))));
        assert!(!ImageDigests::is_containerd(&info(serde_json::json!([
            ["Backing Filesystem", "extfs"],
            ["Supports d_type", "true"]
        ]))));
        assert!(!ImageDigests::is_containerd(&info(serde_json::Value::Null)));
    }
}
