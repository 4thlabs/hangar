//! The images on the host, by their registry digests, and the images that the containers of the compose projects run.

use std::collections::HashMap;

use super::engine::{ImageSummary, Images as _};
use super::{ComposeContainers, Docker, DockerError};

/// The registry digests of the images on the host, by image id: what a registry served for each, which a check for a
/// newer image compares with what the registry serves now.
///
/// Docker keeps its images in one of two stores, which give them apart. On the classic one, an image's id is the
/// digest of its config: a pulled image keeps the digest of its manifest, `nginx@sha256:...`, even once its reference
/// names a newer one, and an image built on the host has none. On containerd's, Docker 29's default, an image's id is
/// the digest of what was pulled, which its registry digest names too, and an image built on the host has one of its
/// own id alike; an image pulled whose reference names a newer one has none left.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImageDigests {
    by_id: HashMap<String, Vec<String>>,
    /// Whether an image's registry digest names its own id, as on containerd's store alone.
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
    /// Whether the image was built on the host, which no registry serves: on the classic store, one with no registry
    /// digest. On containerd's, an image built on the host has a registry digest as a pulled one does: the compose
    /// file, whose service builds it, tells it, which the caller reads.
    pub is_built_here: bool,
}

impl ImageDigests {
    /// The digests of the images that the daemon lists.
    fn new(images: Vec<ImageSummary>) -> Self {
        let is_containerd = images.iter().any(|image| {
            image.repo_digests.iter().any(|digest| {
                digest
                    .rsplit_once('@')
                    .is_some_and(|(_, digest)| digest == image.id)
            })
        });

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
    /// The images the containers of the `installed` projects run, by the image each was created from, never by its
    /// reference: `docker compose pull` moves the reference and leaves the containers on their image until they are
    /// recreated, so the reference would call an app up to date while it still runs the old image.
    pub fn running_images<I>(&self, installed: I, digests: &ImageDigests) -> Vec<RunningImage>
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        let installed: Vec<I::Item> = installed.into_iter().collect();

        self.as_slice()
            .iter()
            .filter(|container| {
                installed
                    .iter()
                    .any(|name| name.as_ref() == container.project)
            })
            .map(|container| {
                let image_digests = digests.get(&container.image_id).to_vec();

                RunningImage {
                    project: container.project.clone(),
                    service: container.service.clone(),
                    image: container.image.clone(),
                    image_id: container.image_id.clone(),
                    is_built_here: image_digests.is_empty() && !digests.is_containerd,
                    digests: image_digests,
                }
            })
            .collect()
    }
}

impl Docker {
    /// The registry digests of every image on the host, by image id.
    ///
    /// # Errors
    ///
    /// [`DockerError::Daemon`] when the daemon cannot list its images.
    pub async fn image_digests(&self) -> Result<ImageDigests, DockerError> {
        let images = self
            .engine
            .images()
            .list()
            .await
            .map_err(|error| DockerError::daemon("list the images", error))?;

        Ok(ImageDigests::new(images))
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

    #[test]
    fn gives_the_digests_of_the_image_each_container_of_an_installed_project_was_created_from() {
        let digests = ImageDigests::new(vec![
            image("sha256:old", &["nginx@sha256:1"]),
            image("sha256:new", &["nginx@sha256:2"]),
        ]);
        let containers = ComposeContainers::new(vec![
            container("alpha", "sha256:old"),
            container("beta", "sha256:new"),
            container("gamma", "sha256:built-here"),
        ]);

        assert_eq!(
            containers.running_images(["alpha", "gamma"], &digests),
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
        // The classic store: the ids are the digests of the configs, which no registry digest names.
        let classic = ImageDigests::new(vec![
            image("sha256:old", &[]),
            image("sha256:config", &["nginx@sha256:manifest"]),
        ]);
        // containerd's: a pulled image's id is its registry digest; `sha256:old`, pulled, lost its own once its reference
        // named a newer image.
        let containerd = ImageDigests::new(vec![
            image("sha256:old", &[]),
            image("sha256:new", &["nginx@sha256:new"]),
        ]);

        assert!(containers.running_images(["alpha"], &classic)[0].is_built_here);
        assert!(!containers.running_images(["alpha"], &containerd)[0].is_built_here);
    }
}
