//! The scheduler of the jobs: the crons that ask for them, the queues they wait their turn in, each running one job at
//! a time, and the runs it keeps, in memory, for the settings.

use std::collections::{BTreeMap, HashMap};
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures::FutureExt;
use hangar_api::{ErrorCode, ErrorDetail, Job, JobQueue, JobRun, JobState};
use hangar_core::{CancellationToken, CronSchedule};
use jiff::Zoned;
use tokio::sync::{Notify, watch};
use tokio::task::AbortHandle;

use super::Clock;
use crate::timestamp::Timestamp;

/// What runs the jobs, for the [`Scheduler`]: the server's own, or a test's.
pub(crate) trait JobRunner: Send + Sync + 'static {
    /// Runs `job` to its end, or until `cancel` is cancelled, which it stops at its next step for: it then ends as it
    /// is, its run canceled. A failure is the code the run keeps, its cause logged.
    fn run(
        &self,
        job: Job,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<(), ErrorCode>> + Send;
}

/// Asks for the jobs on their crons, runs each in its queue, one at a time per queue in the order they were asked
/// for, and keeps their runs: those that wait or run, and the last that ended, [`KEPT`](Self::KEPT) in all. Shared:
/// it lives in an `Arc`.
#[derive(Debug)]
pub(crate) struct Scheduler<R> {
    runner: R,
    clock: Clock,
    runs: Mutex<Runs>,
    /// What tells each queue's worker that a run joined it, by queue; a queue has its worker from its first run.
    queues: Mutex<HashMap<JobQueue, Arc<Notify>>>,
    /// The task of each cron, by the job it asks for.
    crons: Mutex<HashMap<Job, AbortHandle>>,
    /// Told each time a run is asked for, starts, ends or is canceled.
    changed: watch::Sender<()>,
}

/// The runs kept, by id, and the id of the next.
#[derive(Debug)]
struct Runs {
    kept: BTreeMap<u64, Run>,
    next_id: u64,
}

/// A run of a job.
#[derive(Debug)]
struct Run {
    job: Job,
    state: JobState,
    created_at: jiff::Timestamp,
    started_at: Option<jiff::Timestamp>,
    ended_at: Option<jiff::Timestamp>,
    error: Option<ErrorCode>,
    /// Cancelled to stop it.
    cancel: CancellationToken,
}

impl<R: JobRunner> Scheduler<R> {
    /// How many runs are kept: those that wait or run, and the last that ended.
    const KEPT: usize = 50;

    /// A scheduler of the jobs that `runner` runs, its crons read in the time of `clock`. The ids of its runs start
    /// from the time it starts, in milliseconds since 1970: a page that holds the id of a run of the server before a
    /// restart names no run of this one.
    pub(crate) fn new(runner: R, clock: Clock) -> Arc<Self> {
        let first_id = u64::try_from(clock.now().timestamp().as_millisecond()).unwrap_or(1);

        Arc::new(Self {
            runner,
            clock,
            runs: Mutex::new(Runs {
                kept: BTreeMap::new(),
                next_id: first_id.max(1),
            }),
            queues: Mutex::new(HashMap::new()),
            crons: Mutex::new(HashMap::new()),
            changed: watch::Sender::new(()),
        })
    }

    /// Asks for `job` each time `cron` fires, in the time of the clock, from now on, in place of its cron before: a run
    /// of it that waits or runs then is not asked for twice. A cron that never fires again ends.
    pub(crate) fn schedule(self: &Arc<Self>, job: Job, cron: CronSchedule) {
        let this = Arc::clone(self);
        let task = tokio::spawn(async move { this.fire(job, &cron).await });

        if let Some(previous) = self.crons().insert(job, task.abort_handle()) {
            previous.abort();
        }
    }

    /// Asks for `job` each time `cron` fires.
    async fn fire(self: Arc<Self>, job: Job, cron: &CronSchedule) {
        let mut fired = None;

        loop {
            let Some(next) = Self::next_fire(cron, &self.clock.now(), fired.as_ref()) else {
                tracing::warn!(?job, %cron, "a job's cron fires no more");
                return;
            };

            // Waited again when the system's clock was set back meanwhile.
            loop {
                let wait = next
                    .timestamp()
                    .duration_since(self.clock.now().timestamp());
                let Ok(wait) = Duration::try_from(wait) else {
                    break;
                };

                if wait.is_zero() {
                    break;
                }

                tokio::time::sleep(wait).await;
            }

            tracing::info!(?job, %cron, "a job's cron fires");
            self.enqueue(job);
            fired = Some(next);
        }
    }

    /// When `cron` fires next after `now`, and after the time it `fired` at last: a clock set back once it fired does
    /// not fire it twice at that time.
    fn next_fire(cron: &CronSchedule, now: &Zoned, fired: Option<&Zoned>) -> Option<Zoned> {
        let after = match fired {
            Some(fired) if fired > now => fired,
            _ => now,
        };

        cron.next_after(after)
    }

    /// Asks for `job` now: a new run, which waits its turn in its queue, or the run of it that waits or runs already.
    pub(crate) fn enqueue(self: &Arc<Self>, job: Job) -> JobRun {
        let queue = Self::queue(job);
        let run = {
            let mut runs = self.runs();
            let active = runs
                .kept
                .iter()
                .find(|(_, run)| run.job == job && run.is_active())
                .map(|(id, run)| Self::view(*id, run));

            if let Some(active) = active {
                return active;
            }

            let id = runs.next_id;
            let run = Run {
                job,
                state: JobState::Waiting,
                created_at: self.clock.now().timestamp(),
                started_at: None,
                ended_at: None,
                error: None,
                cancel: CancellationToken::new(),
            };
            let view = Self::view(id, &run);

            runs.next_id += 1;
            runs.kept.insert(id, run);
            runs.forget_the_oldest(Self::KEPT);
            view
        };

        self.changed.send_replace(());
        self.queued(queue).notify_one();
        run
    }

    /// The runs kept, the newest first.
    pub(crate) fn list(&self) -> Vec<JobRun> {
        self.runs()
            .kept
            .iter()
            .rev()
            .map(|(id, run)| Self::view(*id, run))
            .collect()
    }

    /// Asks again for the job of the run `id`, as [`enqueue`](Self::enqueue) does.
    ///
    /// # Errors
    ///
    /// `jobs.unknown_run` when no run `id` is kept.
    pub(crate) fn run_again(self: &Arc<Self>, id: u64) -> Result<JobRun, ErrorCode> {
        let job = self.runs().kept.get(&id).map(|run| run.job);
        let Some(job) = job else {
            return Err(ErrorCode::UnknownJobRun { run: id });
        };

        tracing::info!(id, ?job, "a job is asked for again");

        Ok(self.enqueue(job))
    }

    /// Cancels the run `id`: one that waits leaves its queue, canceled; one that runs is told to stop, and ends
    /// canceled once it has.
    ///
    /// # Errors
    ///
    /// `jobs.unknown_run` when no run `id` is kept, `jobs.ended` when it has ended.
    pub(crate) fn cancel(&self, id: u64) -> Result<JobRun, ErrorCode> {
        let now = self.clock.now().timestamp();
        let mut runs = self.runs();
        let Some(run) = runs.kept.get_mut(&id) else {
            return Err(ErrorCode::UnknownJobRun { run: id });
        };

        match run.state {
            JobState::Waiting => {
                run.state = JobState::Canceled;
                run.ended_at = Some(now);
            }
            JobState::Running => run.cancel.cancel(),
            JobState::Completed | JobState::Failed | JobState::Canceled => {
                return Err(ErrorCode::JobEnded { run: id });
            }
        }

        tracing::info!(id, job = ?run.job, "a job is canceled");

        let view = Self::view(id, run);

        drop(runs);
        self.changed.send_replace(());

        Ok(view)
    }

    /// The queue `job` waits its turn in.
    fn queue(job: Job) -> JobQueue {
        match job {
            Job::ImageCheck | Job::AutoUpdate => JobQueue::Default,
        }
    }

    /// What tells the worker of `queue` that a run joined it, once the worker is started.
    fn queued(self: &Arc<Self>, queue: JobQueue) -> Arc<Notify> {
        let mut queues = self.queues.lock().unwrap_or_else(PoisonError::into_inner);

        if let Some(queued) = queues.get(&queue) {
            return Arc::clone(queued);
        }

        let queued = Arc::new(Notify::new());

        queues.insert(queue, Arc::clone(&queued));
        tokio::spawn(Arc::clone(self).work(queue, Arc::clone(&queued)));
        queued
    }

    /// Runs the runs of `queue`, one at a time, the oldest first, waiting for the next as `queued` says it came.
    async fn work(self: Arc<Self>, queue: JobQueue, queued: Arc<Notify>) {
        loop {
            let Some((id, job, cancel)) = self.start_next(queue) else {
                queued.notified().await;
                continue;
            };

            tracing::info!(id, ?job, "a job starts");

            // A panic of the job fails its run, and the queue goes on.
            let ran = AssertUnwindSafe(self.runner.run(job, cancel.clone()))
                .catch_unwind()
                .await;

            self.end(id, ran, &cancel);
        }
    }

    /// Marks the oldest run waiting in `queue` running, and gives what runs it.
    fn start_next(&self, queue: JobQueue) -> Option<(u64, Job, CancellationToken)> {
        let now = self.clock.now().timestamp();
        let mut runs = self.runs();
        let (id, run) = runs
            .kept
            .iter_mut()
            .find(|(_, run)| run.state == JobState::Waiting && Self::queue(run.job) == queue)?;

        run.state = JobState::Running;
        run.started_at = Some(now);

        let started = (*id, run.job, run.cancel.clone());

        drop(runs);
        self.changed.send_replace(());

        Some(started)
    }

    /// Ends the run `id` as `ran` says, canceled when `cancel` was cancelled, whatever it gave.
    fn end(
        &self,
        id: u64,
        ran: std::thread::Result<Result<(), ErrorCode>>,
        cancel: &CancellationToken,
    ) {
        let now = self.clock.now().timestamp();
        let (state, error) = match ran {
            _ if cancel.is_cancelled() => (JobState::Canceled, None),
            Ok(Ok(())) => (JobState::Completed, None),
            Ok(Err(code)) => (JobState::Failed, Some(code)),
            Err(_) => {
                tracing::error!(id, "a job panicked");

                (JobState::Failed, Some(ErrorCode::JobCrashed))
            }
        };
        let mut runs = self.runs();

        // Kept while it runs: only an ended run is forgotten.
        if let Some(run) = runs.kept.get_mut(&id) {
            tracing::info!(id, job = ?run.job, ?state, "a job ends");

            run.state = state;
            run.ended_at = Some(now);
            run.error = error;
        }

        drop(runs);
        self.changed.send_replace(());
    }

    /// The run `id` as the page reads it.
    fn view(id: u64, run: &Run) -> JobRun {
        JobRun {
            id,
            job: run.job,
            queue: Self::queue(run.job),
            state: run.state,
            created_at: Timestamp::format(run.created_at),
            started_at: run.started_at.map(Timestamp::format),
            ended_at: run.ended_at.map(Timestamp::format),
            error: run.error.clone().map(ErrorDetail::from),
        }
    }

    /// The runs kept, whatever a panic left them: each change is written whole.
    fn runs(&self) -> MutexGuard<'_, Runs> {
        self.runs.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The task of each cron, whatever a panic left them.
    fn crons(&self) -> MutexGuard<'_, HashMap<Job, AbortHandle>> {
        self.crons.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Runs {
    /// Forgets the oldest runs that ended past the last `kept`; a run that waits or runs is never forgotten.
    fn forget_the_oldest(&mut self, kept: usize) {
        let excess = self.kept.len().saturating_sub(kept);
        let ended: Vec<u64> = self
            .kept
            .iter()
            .filter(|(_, run)| !run.is_active())
            .map(|(id, _)| *id)
            .take(excess)
            .collect();

        for id in ended {
            self.kept.remove(&id);
        }
    }
}

impl Run {
    /// Whether it waits or runs.
    fn is_active(&self) -> bool {
        matches!(self.state, JobState::Waiting | JobState::Running)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use hangar_api::{ErrorCode, Job, JobQueue, JobRun, JobState};
    use hangar_core::{CancellationToken, CronSchedule};
    use jiff::Zoned;
    use tokio::sync::{Semaphore, mpsc};

    use super::{Clock, JobRunner, Scheduler};

    /// A runner that tells each job it starts, then holds it until the test lets one go, or until it is canceled; it
    /// ends as the test said, or panics.
    struct FakeRunner {
        started: mpsc::UnboundedSender<Job>,
        released: Semaphore,
        outcome: Mutex<Outcome>,
    }

    #[derive(Debug, Clone)]
    enum Outcome {
        Succeeds,
        Fails(ErrorCode),
        Panics,
    }

    impl JobRunner for FakeRunner {
        async fn run(&self, job: Job, cancel: CancellationToken) -> Result<(), ErrorCode> {
            self.started.send(job).expect("the test listens");

            tokio::select! {
                permit = self.released.acquire() => permit.expect("the semaphore stays open").forget(),
                () = cancel.cancelled() => return Ok(()),
            }

            let outcome = self
                .outcome
                .lock()
                .expect("no test panics with the lock")
                .clone();

            match outcome {
                Outcome::Succeeds => Ok(()),
                Outcome::Fails(code) => Err(code),
                Outcome::Panics => panic!("the job fails as the test says"),
            }
        }
    }

    /// A scheduler on a fake runner, its time 2026-11-26 09:30 in UTC moved by Tokio's paused clock, and the jobs it
    /// starts, in order.
    fn scheduler() -> (Arc<Scheduler<FakeRunner>>, mpsc::UnboundedReceiver<Job>) {
        let (started, starts) = mpsc::unbounded_channel();
        let runner = FakeRunner {
            started,
            released: Semaphore::new(0),
            outcome: Mutex::new(Outcome::Succeeds),
        };
        let origin = utc("2026-11-26T09:30:00Z");

        (Scheduler::new(runner, Clock::starting_at(origin)), starts)
    }

    /// `time`, written in RFC 3339, in UTC: no time zone database is needed to read it.
    fn utc(time: &str) -> Zoned {
        time.parse::<jiff::Timestamp>()
            .expect("a time")
            .to_zoned(jiff::tz::TimeZone::UTC)
    }

    /// The run `id` as kept.
    fn run(scheduler: &Scheduler<FakeRunner>, id: u64) -> JobRun {
        scheduler
            .list()
            .into_iter()
            .find(|run| run.id == id)
            .expect("the run is kept")
    }

    /// Waits until the run `id` is in `state`, as the scheduler tells each change.
    async fn reaches(scheduler: &Scheduler<FakeRunner>, id: u64, state: JobState) -> JobRun {
        let mut changed = scheduler.changed.subscribe();

        loop {
            let run = run(scheduler, id);

            if run.state == state {
                return run;
            }

            changed.changed().await.expect("the scheduler lives");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn asks_for_a_job_each_time_its_cron_fires() {
        let (scheduler, mut starts) = scheduler();

        scheduler.runner.released.add_permits(2);
        scheduler.schedule(
            Job::ImageCheck,
            CronSchedule::parse("17 */4 * * *").expect("a valid cron"),
        );

        assert_eq!(starts.recv().await, Some(Job::ImageCheck));
        assert_eq!(
            scheduler.clock.now().to_string(),
            "2026-11-26T12:17:00+00:00[UTC]"
        );

        let first = scheduler.list()[0].id;
        let first = reaches(&scheduler, first, JobState::Completed).await;

        assert_eq!(first.created_at, "2026-11-26T12:17:00.000Z");
        assert_eq!(starts.recv().await, Some(Job::ImageCheck));
        assert_eq!(
            scheduler.clock.now().to_string(),
            "2026-11-26T16:17:00+00:00[UTC]"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn runs_one_job_at_a_time_in_a_queue_in_the_order_they_were_asked_for() {
        let (scheduler, mut starts) = scheduler();

        let check = scheduler.enqueue(Job::ImageCheck);
        let update = scheduler.enqueue(Job::AutoUpdate);

        assert_eq!(check.queue, update.queue);
        assert_eq!(update.queue, JobQueue::Default);
        assert_eq!(starts.recv().await, Some(Job::ImageCheck));

        // An hour later, the update still waits for the check.
        tokio::time::sleep(Duration::from_secs(3600)).await;

        assert!(starts.try_recv().is_err());
        assert_eq!(run(&scheduler, check.id).state, JobState::Running);
        assert_eq!(run(&scheduler, update.id).state, JobState::Waiting);

        scheduler.runner.released.add_permits(1);

        assert_eq!(starts.recv().await, Some(Job::AutoUpdate));
        assert_eq!(run(&scheduler, check.id).state, JobState::Completed);
    }

    #[tokio::test(start_paused = true)]
    async fn gives_the_run_of_a_job_that_waits_or_runs_rather_than_a_second() {
        let (scheduler, mut starts) = scheduler();

        let running = scheduler.enqueue(Job::ImageCheck);

        starts.recv().await;

        let waiting = scheduler.enqueue(Job::AutoUpdate);

        assert_eq!(scheduler.enqueue(Job::ImageCheck).id, running.id);
        assert_eq!(scheduler.enqueue(Job::AutoUpdate).id, waiting.id);
        assert_eq!(scheduler.list().len(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn cancels_a_run_that_waits_and_stops_one_that_runs() {
        let (scheduler, mut starts) = scheduler();
        let running = scheduler.enqueue(Job::ImageCheck);
        let waiting = scheduler.enqueue(Job::AutoUpdate);

        starts.recv().await;

        let canceled = scheduler.cancel(waiting.id).expect("canceled");

        assert_eq!(canceled.state, JobState::Canceled);
        assert!(canceled.started_at.is_none() && canceled.ended_at.is_some());

        scheduler.cancel(running.id).expect("told to stop");

        let stopped = reaches(&scheduler, running.id, JobState::Canceled).await;

        assert!(stopped.error.is_none());
        assert_eq!(
            scheduler.cancel(running.id),
            Err(ErrorCode::JobEnded { run: running.id })
        );
        assert_eq!(
            scheduler.cancel(99),
            Err(ErrorCode::UnknownJobRun { run: 99 })
        );

        // The update canceled while it waited never started.
        tokio::time::sleep(Duration::from_secs(3600)).await;

        assert!(starts.try_recv().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn runs_the_job_of_a_run_again_in_a_new_run() {
        let (scheduler, mut starts) = scheduler();

        scheduler.runner.released.add_permits(2);

        let first = scheduler.enqueue(Job::AutoUpdate);

        reaches(&scheduler, first.id, JobState::Completed).await;

        let again = scheduler.run_again(first.id).expect("asked for again");

        assert_ne!(again.id, first.id);
        assert_eq!(again.job, Job::AutoUpdate);
        assert_eq!(starts.recv().await, Some(Job::AutoUpdate));
        assert_eq!(starts.recv().await, Some(Job::AutoUpdate));
        assert_eq!(
            scheduler.run_again(99),
            Err(ErrorCode::UnknownJobRun { run: 99 })
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_the_last_fifty_runs() {
        let (scheduler, _starts) = scheduler();

        scheduler.runner.released.add_permits(55);

        let mut asked = Vec::new();

        for _ in 0..55 {
            let run = scheduler.enqueue(Job::ImageCheck);

            reaches(&scheduler, run.id, JobState::Completed).await;
            asked.push(run.id);
        }

        let kept: Vec<u64> = scheduler.list().iter().map(|run| run.id).collect();
        let last: Vec<u64> = asked[5..].iter().rev().copied().collect();

        assert_eq!(kept, last);
    }

    #[tokio::test(start_paused = true)]
    async fn numbers_its_runs_from_the_time_it_starts() {
        let (scheduler, _starts) = scheduler();

        let first = scheduler.enqueue(Job::ImageCheck);
        let second = scheduler.enqueue(Job::AutoUpdate);

        // 2026-11-26T09:30:00Z, in milliseconds: a server that starts later numbers its runs past it.
        assert_eq!(first.id, 1_795_685_400_000);
        assert_eq!(second.id, first.id + 1);
    }

    #[test]
    fn fires_once_at_a_time_when_the_clock_is_set_back_after_it() {
        let cron = CronSchedule::parse("17 */4 * * *").expect("a valid cron");
        let fired = utc("2026-11-26T12:17:00Z");
        let set_back = utc("2026-11-26T12:16:59Z");
        let next = Scheduler::<FakeRunner>::next_fire(&cron, &set_back, Some(&fired))
            .expect("a time that comes");

        assert_eq!(next.to_string(), "2026-11-26T16:17:00+00:00[UTC]");
    }

    #[tokio::test(start_paused = true)]
    async fn fails_a_run_with_its_code_or_when_it_panics_and_runs_the_next() {
        let (scheduler, mut starts) = scheduler();

        *scheduler.runner.outcome.lock().expect("the lock") =
            Outcome::Fails(ErrorCode::DockerUnavailable);
        scheduler.runner.released.add_permits(3);

        let failed = scheduler.enqueue(Job::ImageCheck);
        let failed = reaches(&scheduler, failed.id, JobState::Failed).await;

        assert_eq!(
            failed.error.map(|error| error.code),
            Some(ErrorCode::DockerUnavailable)
        );

        *scheduler.runner.outcome.lock().expect("the lock") = Outcome::Panics;

        let crashed = scheduler.enqueue(Job::ImageCheck);
        let crashed = reaches(&scheduler, crashed.id, JobState::Failed).await;

        assert_eq!(
            crashed.error.map(|error| error.code),
            Some(ErrorCode::JobCrashed)
        );

        *scheduler.runner.outcome.lock().expect("the lock") = Outcome::Succeeds;

        let next = scheduler.enqueue(Job::AutoUpdate);

        reaches(&scheduler, next.id, JobState::Completed).await;

        for job in [Job::ImageCheck, Job::ImageCheck, Job::AutoUpdate] {
            assert_eq!(starts.recv().await, Some(job));
        }
    }
}
