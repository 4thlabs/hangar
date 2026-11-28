//! The jobs: what the server runs on its own crons, the image check, the update of the apps and the backup of each app
//! `hangar.yml` gives a schedule, and again when a user asks. They wait their turn in a queue that runs one at a time,
//! the backups in their own, and the server keeps their last 50 runs in memory, for the settings; what the last image
//! check found is kept by the Docker state, for the Docker pages.

mod clock;
mod routes;
mod scheduler;
mod updates;

use std::collections::HashSet;
use std::sync::Arc;

use hangar_api::{ErrorCode, Job};
use hangar_core::{CancellationToken, Config, CronSchedule};
use tokio::sync::watch;

pub(crate) use clock::Clock;
use scheduler::{JobRunner, Scheduler};
pub(crate) use updates::Updates;

use crate::backups::Backups;

/// The jobs of the server, on their crons: the scheduler, running the jobs of the updates and the backups.
pub(crate) type Jobs = Scheduler<HangarJobs>;

/// What runs the server's jobs.
#[derive(Debug)]
pub(crate) struct HangarJobs {
    updates: Updates,
    backups: Arc<Backups>,
}

impl HangarJobs {
    /// Every four hours, off the hour, as the Waku version: each check counts against Docker Hub's limit for an
    /// address, and on the hour is when every other cron asks the registries too.
    const IMAGE_CHECK: &str = "17 */4 * * *";

    /// Every night, when nobody uses the apps, as each update recreates containers, clear of the check at 04:17.
    const AUTO_UPDATE: &str = "47 4 * * *";

    /// The jobs of the server, run by `updates` and `backups`, their crons read in the time of `clock`.
    pub(crate) fn scheduler(updates: Updates, backups: Arc<Backups>, clock: Clock) -> Arc<Jobs> {
        Scheduler::new(Self { updates, backups }, clock)
    }

    /// Starts the crons of `jobs`, and an image check at once, without waiting for the first cron: the registries'
    /// answers are kept in memory alone. The crons of the backups are those of the `hangar.yml` that `backups` reads,
    /// read again each time `config_changes` tells it changed.
    pub(crate) fn start(
        jobs: &Arc<Jobs>,
        backups: Arc<Backups>,
        mut config_changes: watch::Receiver<()>,
    ) {
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

        let jobs = Arc::clone(jobs);

        tokio::spawn(async move {
            loop {
                config_changes.mark_unchanged();

                match backups.config().await {
                    Ok(config) => Self::schedule_backups(&jobs, &config),
                    // Logged with its cause: the crons stay as they were.
                    Err(code) => tracing::warn!(
                        code = code.code(),
                        "the crons of the backups are not read again"
                    ),
                }

                if config_changes.changed().await.is_err() {
                    return;
                }
            }
        });
    }

    /// Gives `jobs` a cron for the backup of each app `config` gives a schedule, in place of the one before, and stops
    /// those of the apps it no longer does.
    fn schedule_backups<R: JobRunner>(jobs: &Arc<Scheduler<R>>, config: &Config) {
        let mut scheduled = HashSet::new();

        for backup in &config.backups {
            let Some(schedule) = &backup.schedule else {
                continue;
            };
            let job = Job::Backup {
                app: backup.app.clone(),
            };

            match CronSchedule::parse(schedule) {
                Ok(cron) => {
                    jobs.schedule(job.clone(), cron);
                    scheduled.insert(job);
                }
                // hangar.yml checks its crons as node-cron reads them, which the schedule reads too.
                Err(error) => {
                    tracing::warn!(app = %backup.app, %error, "a backup's cron is not read");
                }
            }
        }

        for job in jobs.scheduled() {
            let is_dropped = match &job {
                Job::Backup { .. } => !scheduled.contains(&job),
                Job::ImageCheck | Job::AutoUpdate => false,
            };

            if is_dropped {
                jobs.unschedule(&job);
            }
        }
    }
}

impl JobRunner for HangarJobs {
    async fn run(&self, job: Job, cancel: CancellationToken) -> Result<(), ErrorCode> {
        match job {
            Job::ImageCheck => self.updates.check_images(&cancel).await,
            Job::AutoUpdate => self.updates.update_apps(&cancel).await,
            Job::Backup { app } => self.backups.back_up(&app, &cancel).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use hangar_api::{ErrorCode, Job};
    use hangar_core::{CancellationToken, Config, CronSchedule};

    use super::{Clock, HangarJobs, JobRunner, Scheduler};

    /// A runner whose jobs end at once.
    struct Idle;

    impl JobRunner for Idle {
        async fn run(&self, _: Job, _: CancellationToken) -> Result<(), ErrorCode> {
            Ok(())
        }
    }

    #[test]
    fn has_valid_crons() {
        for cron in [HangarJobs::IMAGE_CHECK, HangarJobs::AUTO_UPDATE] {
            assert!(CronSchedule::parse(cron).is_ok(), "{cron}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn schedules_the_backups_hangar_yml_gives_a_schedule_and_drops_those_it_no_longer_does() {
        let origin = "2026-11-26T09:30:00Z"
            .parse::<jiff::Timestamp>()
            .expect("a time")
            .to_zoned(jiff::tz::TimeZone::UTC);
        let jobs = Scheduler::new(Idle, Clock::starting_at(origin));
        let backup = |app: &str| Job::Backup {
            app: app.to_owned(),
        };
        let scheduled =
            |jobs: &Scheduler<Idle>| jobs.scheduled().into_iter().collect::<HashSet<_>>();
        let config = |source: &str| Config::parse(source).expect("a valid hangar.yml");

        jobs.schedule(
            Job::ImageCheck,
            CronSchedule::parse(HangarJobs::IMAGE_CHECK).expect("a valid cron"),
        );
        HangarJobs::schedule_backups(
            &jobs,
            &config(
                "categories: []\nbackups:\n  - { app: alpha, schedule: '0 3 * * *' }\n  - { app: beta }\n",
            ),
        );

        assert_eq!(
            scheduled(&jobs),
            HashSet::from([Job::ImageCheck, backup("alpha")])
        );

        HangarJobs::schedule_backups(
            &jobs,
            &config("categories: []\nbackups:\n  - { app: beta, schedule: '0 4 * * *' }\n"),
        );

        assert_eq!(
            scheduled(&jobs),
            HashSet::from([Job::ImageCheck, backup("beta")])
        );
    }
}
