//! The images on the host, by their registry digests, and the images that the containers of the compose projects run.

use std::collections::HashMap;

use super::engine::{ImageSummary, Images as _};
use super::{ComposeContainers, Docker, DockerError};

/// The registry digests of the images on the host, by image id: what a registry served for each, which a check for a
/// newer image compares with what the registry serves now.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImageDigests {
    by_id: HashMap<String, Vec<String>>,
}

/// The image a container of an installed compose project runs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RunningImage {
    /// The project of the container.
    pub project: String,
    /// The image as compose runs it, such as `nginx:alpine`.
    pub image: String,
    /// The registry digests of the image the container was created from, each `name@sha256:...`; none for an image
    /// built on the host, or one the host no longer has.
    pub digests: Vec<String>,
}

impl ImageDigests {
    /// The digests of the images that the daemon lists.
    fn new(images: Vec<ImageSummary>) -> Self {
        Self {
            by_id: images
                .into_iter()
                .map(|image| (image.id, image.repo_digests))
                .collect(),
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
            .map(|container| RunningImage {
                project: container.project.clone(),
                image: container.image.clone(),
                digests: digests.get(&container.image_id).to_vec(),
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

    #[test]
    fn gives_the_digests_of_the_image_each_container_of_an_installed_project_was_created_from() {
        let digests = ImageDigests::new(vec![
            ImageSummary {
                id: "sha256:old".to_owned(),
                repo_digests: vec!["nginx@sha256:1".to_owned()],
            },
            ImageSummary {
                id: "sha256:new".to_owned(),
                repo_digests: vec!["nginx@sha256:2".to_owned()],
            },
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
                    image: "nginx:alpine".to_owned(),
                    digests: vec!["nginx@sha256:1".to_owned()],
                },
                RunningImage {
                    project: "gamma".to_owned(),
                    image: "nginx:alpine".to_owned(),
                    digests: Vec::new(),
                },
            ]
        );
    }
}
