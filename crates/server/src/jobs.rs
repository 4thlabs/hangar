//! The jobs: what the server runs on its own crons, the image check and the update of the apps, and again when a user
//! asks. They wait their turn in a queue that runs one at a time, and the server keeps their last 50 runs in memory,
//! for the settings; what the last image check found is kept by the Docker state, for the Docker pages.

mod clock;
mod routes;
mod scheduler;
mod updates;

use std::sync::Arc;

use hangar_api::{ErrorCode, Job};
use hangar_core::{CancellationToken, CronSchedule};

pub(crate) use clock::Clock;
use scheduler::{JobRunner, Scheduler};
pub(crate) use updates::Updates;

/// The jobs of the server, on their crons: the scheduler, running the jobs of the updates.
pub(crate) type Jobs = Scheduler<HangarJobs>;

/// What runs the server's jobs.
#[derive(Debug)]
pub(crate) struct HangarJobs {
    updates: Updates,
}

impl HangarJobs {
    /// Every four hours, off the hour, as the Waku version: each check counts against Docker Hub's limit for an
    /// address, and on the hour is when every other cron asks the registries too.
    const IMAGE_CHECK: &str = "17 */4 * * *";

    /// Every night, when nobody uses the apps, as each update recreates containers, clear of the check at 04:17.
    const AUTO_UPDATE: &str = "47 4 * * *";

    /// The jobs of the server, run by `updates`, their crons read in the time of `clock`.
    pub(crate) fn scheduler(updates: Updates, clock: Clock) -> Arc<Jobs> {
        Scheduler::new(Self { updates }, clock)
    }

    /// Starts the crons of `jobs`, and an image check at once, without waiting for the first cron: the registries'
    /// answers are kept in memory alone.
    pub(crate) fn start(jobs: &Arc<Jobs>) {
        for (job, cron) in [
            (Job::ImageCheck, Self::IMAGE_CHECK),
            (Job::AutoUpdate, Self::AUTO_UPDATE),
        ] {
            jobs.schedule(
                job,
                CronSchedule::parse(cron).expect("the crons of the jobs are valid"),
            );
        }

        jobs.enqueue(Job::ImageCheck);
    }
}

impl JobRunner for HangarJobs {
    async fn run(&self, job: Job, cancel: CancellationToken) -> Result<(), ErrorCode> {
        match job {
            Job::ImageCheck => self.updates.check_images(&cancel).await,
            Job::AutoUpdate => self.updates.update_apps(&cancel).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use hangar_core::CronSchedule;

    use super::HangarJobs;

    #[test]
    fn has_valid_crons() {
        for cron in [HangarJobs::IMAGE_CHECK, HangarJobs::AUTO_UPDATE] {
            assert!(CronSchedule::parse(cron).is_ok(), "{cron}");
        }
    }
}
