//! The compose projects that a set of containers make up: their services and how they run.

use std::collections::{BTreeMap, BTreeSet};

use super::{ComposeContainer, ContainerState, DockerError, Health};

/// How a compose project, or one of its services, runs as a whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProjectStatus {
    /// Every container runs, and none is unhealthy.
    Running,
    /// Some containers run, others not, and none is unhealthy.
    Partial,
    /// No container runs, or there is none.
    Stopped,
    /// At least one container is unhealthy, whatever the others do.
    Unhealthy,
}

/// A compose project in a line, cheap enough to read for every installed app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposeProjectSummary {
    /// The project's name.
    pub name: String,
    /// How it runs as a whole.
    pub status: ProjectStatus,
    /// How many services its containers belong to.
    pub service_count: usize,
    /// How many of its containers run.
    pub running_count: usize,
    /// How many of its containers are unhealthy.
    pub unhealthy_count: usize,
    /// The full ids of its containers, so that a client can pick its rows out of the stats.
    pub container_ids: Vec<String>,
}

/// A compose service: the replicas of one container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposeService {
    /// The service's name.
    pub name: String,
    /// How it runs as a whole.
    pub status: ProjectStatus,
    /// How many of its containers run.
    pub running_count: usize,
    /// How many of its containers are unhealthy.
    pub unhealthy_count: usize,
    /// Its containers, by replica index.
    pub containers: Vec<ComposeContainer>,
}

/// A compose project with its services, as its page shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposeProjectDetail {
    /// The project in a line.
    pub summary: ComposeProjectSummary,
    /// Its services, by name.
    pub services: Vec<ComposeService>,
}

/// The containers of the compose services on a host, which [`Docker::containers`](super::Docker::containers) reads,
/// grouped by project and by service. Names are ordered by their bytes, the same on every host.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ComposeContainers {
    containers: Vec<ComposeContainer>,
}

/// The running totals of a project, before they become its summary.
#[derive(Default)]
struct ProjectTotals<'a> {
    services: BTreeSet<&'a str>,
    container_ids: Vec<String>,
    running_count: usize,
    unhealthy_count: usize,
}

impl ProjectStatus {
    /// How a project or a service runs, from the counts of its containers: an unhealthy one wins, then it is by
    /// count.
    fn from_counts(container_count: usize, running_count: usize, unhealthy_count: usize) -> Self {
        if unhealthy_count > 0 {
            return Self::Unhealthy;
        }

        if running_count == 0 {
            return Self::Stopped;
        }

        if running_count == container_count {
            return Self::Running;
        }

        Self::Partial
    }
}

impl ComposeContainers {
    /// The projects that these containers make up.
    pub fn new(containers: Vec<ComposeContainer>) -> Self {
        Self { containers }
    }

    /// The containers, in the order the daemon listed them.
    pub fn as_slice(&self) -> &[ComposeContainer] {
        &self.containers
    }

    /// One summary per installed project, by name. Only the projects Hangar installed are kept, and each of them
    /// has its summary even with no container yet, never started or brought down: it is stopped.
    pub fn summaries<I>(&self, installed: I) -> Vec<ComposeProjectSummary>
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        let mut projects: BTreeMap<String, ProjectTotals<'_>> = installed
            .into_iter()
            .map(|name| (name.as_ref().to_owned(), ProjectTotals::default()))
            .collect();

        for container in &self.containers {
            let Some(totals) = projects.get_mut(&container.project) else {
                continue;
            };

            totals.services.insert(&container.service);
            totals.container_ids.push(container.id.clone());
            totals.running_count += usize::from(Self::is_running(container));
            totals.unhealthy_count += usize::from(Self::is_unhealthy(container));
        }

        projects
            .into_iter()
            .map(|(name, totals)| ComposeProjectSummary {
                name,
                status: ProjectStatus::from_counts(
                    totals.container_ids.len(),
                    totals.running_count,
                    totals.unhealthy_count,
                ),
                service_count: totals.services.len(),
                running_count: totals.running_count,
                unhealthy_count: totals.unhealthy_count,
                container_ids: totals.container_ids,
            })
            .collect()
    }

    /// The installed project `project` with its services. With no container yet, it is stopped and has no
    /// service.
    ///
    /// # Errors
    ///
    /// [`DockerError::NotFound`] when `project` is not among the `installed` ones.
    pub fn detail<I>(
        &self,
        project: &str,
        installed: I,
    ) -> Result<ComposeProjectDetail, DockerError>
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        let is_installed = installed.into_iter().any(|name| name.as_ref() == project);
        let summary = self
            .summaries([project])
            .pop()
            .filter(|_| is_installed)
            .ok_or_else(|| DockerError::not_found(format!("compose project {project}")))?;

        Ok(ComposeProjectDetail {
            summary,
            services: self.services(project),
        })
    }

    /// The services of `project`, by name, each with its replicas in index order.
    fn services(&self, project: &str) -> Vec<ComposeService> {
        let mut services: BTreeMap<&str, Vec<ComposeContainer>> = BTreeMap::new();

        for container in self
            .containers
            .iter()
            .filter(|container| container.project == project)
        {
            services
                .entry(&container.service)
                .or_default()
                .push(container.clone());
        }

        services
            .into_iter()
            .map(|(name, mut containers)| {
                // A replica without an index goes last.
                containers.sort_by(|left, right| {
                    let index =
                        |container: &ComposeContainer| container.replica.unwrap_or(u32::MAX);

                    index(left)
                        .cmp(&index(right))
                        .then_with(|| left.name.cmp(&right.name))
                });

                let running_count = containers
                    .iter()
                    .filter(|container| Self::is_running(container))
                    .count();
                let unhealthy_count = containers
                    .iter()
                    .filter(|container| Self::is_unhealthy(container))
                    .count();

                ComposeService {
                    name: name.to_owned(),
                    status: ProjectStatus::from_counts(
                        containers.len(),
                        running_count,
                        unhealthy_count,
                    ),
                    running_count,
                    unhealthy_count,
                    containers,
                }
            })
            .collect()
    }

    fn is_running(container: &ComposeContainer) -> bool {
        container.state == ContainerState::Running
    }

    fn is_unhealthy(container: &ComposeContainer) -> bool {
        container
            .details
            .is_some_and(|details| details.health == Some(Health::Unhealthy))
    }
}

#[cfg(test)]
mod tests {
    use super::super::ContainerDetails;
    use super::*;

    /// A running replica `alpha-web-1`, with no healthcheck.
    fn container() -> ComposeContainer {
        ComposeContainer {
            id: "container-1".to_owned(),
            name: "alpha-web-1".to_owned(),
            project: "alpha".to_owned(),
            service: "web".to_owned(),
            replica: Some(1),
            image: "nginx:alpine".to_owned(),
            state: ContainerState::Running,
            details: Some(ContainerDetails {
                health: None,
                restart_count: Some(0),
            }),
            ports: Vec::new(),
        }
    }

    /// The containers of two projects: `alpha` with a running `web` and an exited `db`, and `beta` with an unhealthy
    /// `api`.
    fn two_projects() -> ComposeContainers {
        ComposeContainers::new(vec![
            ComposeContainer {
                id: "beta-1".to_owned(),
                name: "beta-api-1".to_owned(),
                project: "beta".to_owned(),
                service: "api".to_owned(),
                details: Some(ContainerDetails {
                    health: Some(Health::Unhealthy),
                    restart_count: Some(0),
                }),
                ..container()
            },
            container(),
            ComposeContainer {
                id: "alpha-db-1".to_owned(),
                name: "alpha-db-1".to_owned(),
                service: "db".to_owned(),
                state: ContainerState::Exited,
                ..container()
            },
        ])
    }

    #[test]
    fn sums_up_each_installed_project_by_name() {
        assert_eq!(
            two_projects().summaries(["beta", "alpha"]),
            [
                ComposeProjectSummary {
                    name: "alpha".to_owned(),
                    status: ProjectStatus::Partial,
                    service_count: 2,
                    running_count: 1,
                    unhealthy_count: 0,
                    container_ids: vec!["container-1".to_owned(), "alpha-db-1".to_owned()],
                },
                ComposeProjectSummary {
                    name: "beta".to_owned(),
                    status: ProjectStatus::Unhealthy,
                    service_count: 1,
                    running_count: 1,
                    unhealthy_count: 1,
                    container_ids: vec!["beta-1".to_owned()],
                },
            ]
        );
    }

    #[test]
    fn leaves_out_the_projects_hangar_did_not_install() {
        let names: Vec<String> = two_projects()
            .summaries(["alpha"])
            .into_iter()
            .map(|summary| summary.name)
            .collect();

        assert_eq!(names, ["alpha"]);
    }

    #[test]
    fn sums_up_an_installed_project_with_no_container_as_stopped() {
        assert_eq!(
            ComposeContainers::default().summaries(["gamma"]),
            [ComposeProjectSummary {
                name: "gamma".to_owned(),
                status: ProjectStatus::Stopped,
                service_count: 0,
                running_count: 0,
                unhealthy_count: 0,
                container_ids: Vec::new(),
            }]
        );
    }

    #[test]
    fn runs_a_project_only_when_every_container_runs() {
        assert_eq!(ProjectStatus::from_counts(2, 2, 0), ProjectStatus::Running);
        assert_eq!(ProjectStatus::from_counts(2, 1, 0), ProjectStatus::Partial);
        assert_eq!(ProjectStatus::from_counts(2, 0, 0), ProjectStatus::Stopped);
        assert_eq!(ProjectStatus::from_counts(0, 0, 0), ProjectStatus::Stopped);
        assert_eq!(
            ProjectStatus::from_counts(2, 2, 1),
            ProjectStatus::Unhealthy
        );
    }

    #[test]
    fn details_the_services_by_name_and_their_replicas_by_index() {
        let replica = |replica, name: &str| ComposeContainer {
            id: name.to_owned(),
            name: name.to_owned(),
            replica,
            ..container()
        };
        let containers = ComposeContainers::new(vec![
            replica(None, "alpha-web-x"),
            replica(Some(2), "alpha-web-2"),
            replica(Some(1), "alpha-web-1"),
            ComposeContainer {
                service: "db".to_owned(),
                ..replica(Some(1), "alpha-db-1")
            },
        ]);
        let detail = containers
            .detail("alpha", ["alpha"])
            .expect("alpha is installed");
        let services: Vec<(&str, Vec<&str>)> = detail
            .services
            .iter()
            .map(|service| {
                let names = service
                    .containers
                    .iter()
                    .map(|container| container.name.as_str())
                    .collect();

                (service.name.as_str(), names)
            })
            .collect();

        assert_eq!(
            services,
            [
                ("db", vec!["alpha-db-1"]),
                ("web", vec!["alpha-web-1", "alpha-web-2", "alpha-web-x"]),
            ]
        );
    }

    #[test]
    fn details_only_the_services_of_the_project() {
        let detail = two_projects()
            .detail("beta", ["alpha", "beta"])
            .expect("beta is installed");

        assert_eq!(detail.summary.name, "beta");
        assert_eq!(detail.services.len(), 1);
        assert_eq!(detail.services[0].status, ProjectStatus::Unhealthy);
    }

    #[test]
    fn details_an_installed_project_with_no_container_as_stopped_with_no_service() {
        let detail = ComposeContainers::default()
            .detail("gamma", ["gamma"])
            .expect("gamma is installed");

        assert_eq!(detail.summary.status, ProjectStatus::Stopped);
        assert!(detail.services.is_empty());
    }

    #[test]
    fn finds_no_project_hangar_did_not_install() {
        let error = two_projects()
            .detail("beta", ["alpha"])
            .expect_err("beta is not installed");

        assert!(matches!(error, DockerError::NotFound { .. }), "{error:?}");
    }
}
