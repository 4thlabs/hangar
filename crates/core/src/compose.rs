//! Compose: the `docker compose` commands Hangar runs on the installed apps, on one app or on a batch of them, and
//! the check of a compose file before it is saved.
//!
//! The calls are the Waku version's, so that both run the same projects on one data directory: an app's project is
//! its id, `-p <app>`, its file `app-installed/<app>/compose.yml`, and every call reads `.env.global`:
//!
//! ```text
//! docker compose --env-file <data>/.env.global -p <app> -f <data>/app-installed/<app>/compose.yml up -d
//! ```
//!
//! ```no_run
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! use futures::StreamExt;
//! use hangar_core::{
//!     BatchEvent, Compose, ComposeCommand, DataDir, OnFailure, Output, Runtime, Store, UpOptions,
//! };
//!
//! let data_dir = DataDir::from_env()?;
//! let store = Store::new("https://example.com/store.git", data_dir.clone(), Runtime::new());
//! let compose = Compose::new(data_dir, Runtime::new());
//!
//! compose.run("jellyfin", ComposeCommand::Restart, Output::Inherit).await?;
//!
//! // Runs on its own, in the order of hangar.yml, whoever reads its output.
//! let update = ComposeCommand::Up(UpOptions { pull: true, force_recreate: false });
//! let config = store.config().await?;
//! let batch = compose.batch(update, &["miniflux", "traefik"], &config, OnFailure::CarryOn).await?;
//! let mut output = Box::pin(batch.output());
//!
//! while let Some(event) = output.next().await {
//!     if let BatchEvent::Output { app, line } = event {
//!         print!("{app} | {}", String::from_utf8_lossy(&line));
//!     }
//! }
//!
//! println!("{} failed", batch.finished().await.failures());
//! # Ok(())
//! # }
//! ```

mod batch;
mod command;
mod error;
mod project;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

pub use batch::{AppOutcome, AppStatus, BatchEvent, BatchReport, ComposeBatch, OnFailure};
pub use command::{ComposeCommand, UpOptions};
pub use error::ComposeError;

use crate::store::Disk;
use crate::{Command, CommandRunner, Config, DataDir, Output, RunError, StoreApp};
use batch::BatchRecorder;
use command::Order;
use project::ProjectName;

/// The compose commands of a data directory's installed apps, run by a [`CommandRunner`].
///
/// Each call checks the app anew, so that an app installed or uninstalled meanwhile, by another process or the Waku
/// version, is seen.
#[derive(Debug, Clone)]
pub struct Compose<R> {
    data_dir: DataDir,
    runner: R,
}

impl<R: CommandRunner> Compose<R> {
    /// The compose commands of `data_dir`'s apps, run by `runner`.
    pub fn new(data_dir: DataDir, runner: R) -> Self {
        Self { data_dir, runner }
    }

    /// Whether compose takes `name` as a project, which Hangar gives an app's: lowercase letters, digits, `_` and `-`,
    /// starting with a letter or a digit. A store app may have another id, as `llama.cpp`, that compose cannot run.
    ///
    /// ```
    /// use hangar_core::{Compose, Runtime};
    ///
    /// assert!(Compose::<Runtime>::is_project_name("sync-in"));
    /// assert!(!Compose::<Runtime>::is_project_name("llama.cpp"));
    /// ```
    pub fn is_project_name(name: &str) -> bool {
        ProjectName::is_valid(name)
    }

    /// Runs `command` on the installed app `app`, its output going where `output` says, and waits for its end.
    ///
    /// # Errors
    ///
    /// Returns [`ComposeError::OptionBeforeCommand`] for a command passed as its arguments that does not start with its
    /// name, [`ComposeError::InvalidProject`] when compose cannot take `app` as a project name,
    /// [`ComposeError::NotInstalled`] when it is not installed, neither running anything, and
    /// [`ComposeError::Failed`] when compose fails.
    pub async fn run(
        &self,
        app: &str,
        command: ComposeCommand,
        output: Output,
    ) -> Result<(), ComposeError> {
        Self::check(&command)?;

        let file = self.installed_file(app).await?;
        // `-p` pins the project to the app: compose would derive it from the file's top-level `name`, a display
        // label ("Home Assistant"), and its containers would no longer match the installed app.
        let run = Command::new("docker")
            .args(["compose", "--env-file", self.env_file(), "-p", app, "-f"])
            .arg(Self::arg(&file))
            .args(command.args());

        self.runner
            .run(&run, output)
            .await
            .map_err(|source| ComposeError::Failed {
                app: app.to_owned(),
                command,
                source,
            })
    }

    /// Checks `file` with `docker compose config -q`, read with `.env.global`, as an app's `compose.yml` is checked
    /// before it is saved: the caller writes the new file beside the one it replaces, so that the paths it names
    /// resolve the same, and moves it there once checked.
    ///
    /// # Errors
    ///
    /// Returns [`ComposeError::Invalid`], with compose's complaint, when compose rejects the file,
    /// [`ComposeError::Unchecked`] when it could not check it, as when docker does not start, and
    /// [`ComposeError::NotUtf8`] when its path is not UTF-8.
    pub async fn validate(&self, file: &Path) -> Result<(), ComposeError> {
        let Some(path) = file.to_str() else {
            return Err(ComposeError::NotUtf8 {
                path: file.to_owned(),
            });
        };
        // No `-p`: compose takes some folder names for no project (`llama.cpp`), and a check needs none.
        let check = Command::new("docker").args([
            "compose",
            "--env-file",
            self.env_file(),
            "-f",
            path,
            "config",
            "-q",
        ]);

        Self::checked(self.runner.capture(&check).await.map(drop), file)
    }

    /// Checks `compose` and `swarm` merged with `docker stack config`, as Swarm reads an app that can run there: an
    /// app's `compose.yml` and its `compose.swarm.yml`, one of them the new file of a save. `docker stack` reads no
    /// `--env-file`: `variables`, those of `.env.global`, are set in its environment. It runs on any node, in a swarm
    /// or not.
    ///
    /// # Errors
    ///
    /// Returns [`ComposeError::Invalid`], with Docker's complaint, when Docker rejects the files, and
    /// [`ComposeError::Unchecked`] and [`ComposeError::NotUtf8`] as [`validate`](Self::validate) does; the file they
    /// name is `swarm`.
    pub async fn validate_stack(
        &self,
        compose: &Path,
        swarm: &Path,
        variables: &BTreeMap<String, String>,
    ) -> Result<(), ComposeError> {
        let (Some(compose_path), Some(swarm_path)) = (compose.to_str(), swarm.to_str()) else {
            let path = if compose.to_str().is_none() {
                compose
            } else {
                swarm
            };

            return Err(ComposeError::NotUtf8 {
                path: path.to_owned(),
            });
        };
        let check = Command::new("docker")
            .args(["stack", "config", "-c", compose_path, "-c", swarm_path])
            .envs(variables);

        Self::checked(self.runner.capture(&check).await.map(drop), swarm)
    }

    /// The outcome of a check of `file`: a failure of the command is a refusal, any other a check that did not run.
    fn checked(result: Result<(), RunError>, file: &Path) -> Result<(), ComposeError> {
        result.map_err(|source| match source {
            RunError::Failed { .. } => ComposeError::Invalid {
                file: file.to_owned(),
                source,
            },
            _ => ComposeError::Unchecked {
                file: file.to_owned(),
                source,
            },
        })
    }

    /// Refuses a command whose first word is an option rather than its name, which would override the project or the
    /// file Hangar pins.
    fn check(command: &ComposeCommand) -> Result<(), ComposeError> {
        let Some(option) = command.leading_option() else {
            return Ok(());
        };

        Err(ComposeError::OptionBeforeCommand {
            option: option.to_owned(),
        })
    }

    /// The `compose.yml` of the installed app `app`.
    async fn installed_file(&self, app: &str) -> Result<PathBuf, ComposeError> {
        if !ProjectName::is_valid(app) {
            return Err(ComposeError::InvalidProject {
                app: app.to_owned(),
            });
        }

        let file = self
            .data_dir
            .installed()
            .join(app)
            .join(StoreApp::COMPOSE_FILE);

        if !Disk::exists(&file).await {
            return Err(ComposeError::NotInstalled {
                app: app.to_owned(),
            });
        }

        Ok(file)
    }

    /// `.env.global`, as an argument.
    fn env_file(&self) -> &str {
        Self::arg(self.data_dir.env_file())
    }

    /// A path of the data directory as an argument: [`DataDir`] made sure it is UTF-8, and an app's name is ASCII.
    fn arg(path: &Path) -> &str {
        path.to_str()
            .expect("the paths of the data directory are UTF-8")
    }
}

impl<R: CommandRunner + Clone + 'static> Compose<R> {
    /// How many lines of an app's output a batch takes from its run at once.
    const LINES: usize = 64;

    /// Starts `command` over `apps`, on its own, and returns its handle: it goes on to its end whoever drops the handle
    /// or its output. Its output is kept for whoever listens, from its start, as [`ComposeBatch`] says.
    ///
    /// Once the command fails on an app, the batch carries on with the others or stops, as `on_failure` says.
    ///
    /// The apps run in the order `config` lists them in its categories, those it does not list after, in the order
    /// given; an app given twice runs once. `up` and `restart` run one at a time in that order, `down` in reverse, so
    /// that a reverse proxy listed first comes up first and goes down last, and `pull` on all of them at once.
    ///
    /// Every app is checked before any runs: a batch that would be refused half-way is refused whole.
    ///
    /// # Errors
    ///
    /// Returns [`ComposeError::OptionBeforeCommand`] as [`run`](Self::run) does, [`ComposeError::EmptyBatch`] when
    /// `apps` is empty, [`ComposeError::AttachedBatch`] for an `up` that is
    /// not detached on several apps, and the errors of [`run`](Self::run) that come before compose runs, for the first
    /// app that has one.
    ///
    /// # Panics
    ///
    /// Panics when called outside a Tokio runtime, where the batch cannot be spawned.
    pub async fn batch(
        &self,
        command: ComposeCommand,
        apps: &[impl AsRef<str>],
        config: &Config,
        on_failure: OnFailure,
    ) -> Result<ComposeBatch, ComposeError> {
        Self::check(&command)?;

        let apps = Self::ordered(&command, apps, config)?;

        if command.is_attached() && apps.len() > 1 {
            return Err(ComposeError::AttachedBatch { command });
        }

        for app in &apps {
            self.installed_file(app).await?;
        }

        let (batch, recorder) = ComposeBatch::new(command.clone(), apps.clone());
        let compose = self.clone();
        let task = tokio::spawn(async move {
            compose
                .run_batch(&command, &apps, on_failure, recorder)
                .await;
        });

        tokio::spawn(Self::watch(task, batch.clone()));

        Ok(batch)
    }

    /// Logs the panic of a batch's task, once: its recorder, dropped as it unwinds, reports the apps it did not end.
    async fn watch(task: JoinHandle<()>, batch: ComposeBatch) {
        let Err(error) = task.await else {
            return;
        };

        if error.is_panic() {
            tracing::error!(
                command = %batch.command(),
                apps = %batch.apps().join(", "),
                %error,
                "a compose batch panicked"
            );
        }
    }

    /// `apps` once each, in the order a batch of `command` runs them in.
    fn ordered(
        command: &ComposeCommand,
        apps: &[impl AsRef<str>],
        config: &Config,
    ) -> Result<Vec<Arc<str>>, ComposeError> {
        if apps.is_empty() {
            return Err(ComposeError::EmptyBatch);
        }

        let stacks: HashMap<&str, usize> = config
            .stacks()
            .into_iter()
            .enumerate()
            .map(|(position, stack)| (stack, position))
            .collect();
        let mut seen = HashSet::new();
        let mut ordered: Vec<Arc<str>> = apps
            .iter()
            .map(AsRef::as_ref)
            .filter(|app| seen.insert(*app))
            .map(Arc::from)
            .collect();

        // Stable: the apps `hangar.yml` does not list keep the order they were given in.
        ordered.sort_by_key(|app| stacks.get(app.as_ref()).copied().unwrap_or(usize::MAX));

        if command.order() == Order::Reverse {
            ordered.reverse();
        }

        Ok(ordered)
    }

    /// Runs the batch to its end, recording it; the recorder, dropped at the end, finishes it, with the apps it did not
    /// run on as not run.
    async fn run_batch(
        &self,
        command: &ComposeCommand,
        apps: &[Arc<str>],
        on_failure: OnFailure,
        recorder: BatchRecorder,
    ) {
        match command.order() {
            Order::Parallel => {
                let runs = apps
                    .iter()
                    .map(|app| self.run_recorded(app, command, &recorder));

                futures::future::join_all(runs).await;
            }
            Order::Forward | Order::Reverse => {
                for app in apps {
                    let succeeded = self.run_recorded(app, command, &recorder).await;

                    if !succeeded && on_failure == OnFailure::Stop {
                        return;
                    }
                }
            }
        }
    }

    /// Runs `command` on `app`, its output going to the batch's log as fast as it comes, so that no listener ever
    /// holds the run back. Returns whether it succeeded.
    async fn run_recorded(
        &self,
        app: &Arc<str>,
        command: &ComposeCommand,
        recorder: &BatchRecorder,
    ) -> bool {
        let (sender, mut receiver) = mpsc::channel(Self::LINES);
        let forwarding = async {
            while let Some(line) = receiver.recv().await {
                recorder.line(app, line);
            }
        };

        recorder.started(app);

        let (result, ()) = tokio::join!(
            self.run(app, command.clone(), Output::Lines(sender)),
            forwarding
        );
        let status = match result {
            Ok(()) => AppStatus::Succeeded,
            Err(error) => {
                tracing::error!(%app, %error, "a compose batch failed on an app");

                AppStatus::Failed(Arc::new(error))
            }
        };
        let succeeded = status.is_success();

        recorder.finished(AppOutcome {
            app: Arc::clone(app),
            status,
        });

        succeeded
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::Arc;

    use futures::StreamExt;
    use tempfile::TempDir;
    use tokio::sync::{Semaphore, oneshot, watch};

    use super::{
        AppStatus, BatchEvent, BatchReport, Compose, ComposeCommand, ComposeError, OnFailure,
        UpOptions,
    };
    use crate::runtime::fake::{FakeRunner, Reply};
    use crate::{Command, CommandRunner, Config, DataDir, Output, RunError};

    /// The categories of the store: `beta-app` in both, to check that it runs once.
    const CATEGORIES: &str = "
categories:
  - name: essentials
    color: blue
    stacks: [alpha-app, beta-app]
  - name: utilities
    color: green
    stacks: [beta-app, gamma-app]
";

    /// A data directory whose `app-installed/` holds `apps`, each with a `compose.yml`.
    fn installed(apps: &[&str]) -> (TempDir, DataDir) {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let data_dir = DataDir::new(dir.path()).expect("the temporary directory resolves");

        for app in apps {
            let folder = data_dir.installed().join(app);

            std::fs::create_dir_all(&folder).expect("the app's folder can be made");
            std::fs::write(folder.join("compose.yml"), "services: {}\n")
                .expect("the compose file can be written");
        }

        (dir, data_dir)
    }

    fn config() -> Config {
        Config::parse(CATEGORIES).expect("the categories parse")
    }

    /// The project of each run, read off its `-p`.
    fn projects(runs: &[Command]) -> Vec<String> {
        runs.iter()
            .map(|run| {
                let at = run
                    .args
                    .iter()
                    .position(|arg| arg == "-p")
                    .expect("a compose run names its project");

                run.args[at + 1].clone()
            })
            .collect()
    }

    /// How the batch ended on each app, in its order.
    fn statuses(report: &BatchReport) -> Vec<String> {
        report
            .apps
            .iter()
            .map(|outcome| {
                let status = match outcome.status {
                    AppStatus::Succeeded => "succeeded",
                    AppStatus::Failed(_) => "failed",
                    AppStatus::NotRun => "not run",
                };

                format!("{} {status}", outcome.app)
            })
            .collect()
    }

    /// A runner whose runs panic, as a bug in a runner would.
    #[derive(Debug, Clone)]
    struct Panicking;

    impl CommandRunner for Panicking {
        async fn run(&self, _command: &Command, _output: Output) -> Result<(), RunError> {
            panic!("the runner has a bug")
        }

        async fn capture(&self, _command: &Command) -> Result<String, RunError> {
            panic!("the runner has a bug")
        }
    }

    /// A runner whose commands do not start, as when docker is not installed.
    #[derive(Debug, Clone)]
    struct Unstartable;

    impl Unstartable {
        fn error(command: &Command) -> RunError {
            RunError::Spawn {
                program: command.program.clone(),
                source: std::io::ErrorKind::NotFound.into(),
            }
        }
    }

    impl CommandRunner for Unstartable {
        async fn run(&self, command: &Command, _output: Output) -> Result<(), RunError> {
            Err(Self::error(command))
        }

        async fn capture(&self, command: &Command) -> Result<String, RunError> {
            Err(Self::error(command))
        }
    }

    /// A runner whose runs wait at a gate, so that a test sees a batch in the middle of its run; it can be cloned, as
    /// a batch needs, and its clones share the gate and the runs.
    #[derive(Debug, Clone)]
    struct Gated {
        fake: Arc<FakeRunner>,
        gate: Arc<Semaphore>,
        /// How many runs came to the gate.
        arrived: Arc<watch::Sender<usize>>,
    }

    impl Gated {
        /// A runner whose gate lets every run through.
        fn open() -> Self {
            Self::with_permits(Semaphore::MAX_PERMITS)
        }

        /// A runner whose gate holds the runs until it lets some through.
        fn closed() -> Self {
            Self::with_permits(0)
        }

        fn with_permits(permits: usize) -> Self {
            Self {
                fake: Arc::new(FakeRunner::new()),
                gate: Arc::new(Semaphore::new(permits)),
                arrived: Arc::new(watch::Sender::new(0)),
            }
        }

        /// Lets `runs` more runs through.
        fn let_through(&self, runs: usize) {
            self.gate.add_permits(runs);
        }

        /// Waits until `runs` runs came to the gate.
        async fn until_arrived(&self, runs: usize) {
            self.arrived
                .subscribe()
                .wait_for(|arrived| *arrived >= runs)
                .await
                .expect("the runner holds the sender");
        }
    }

    impl CommandRunner for Gated {
        async fn run(&self, command: &Command, output: Output) -> Result<(), RunError> {
            self.arrived.send_modify(|arrived| *arrived += 1);
            self.gate
                .acquire()
                .await
                .expect("the gate is never closed")
                .forget();

            self.fake.run(command, output).await
        }

        async fn capture(&self, command: &Command) -> Result<String, RunError> {
            self.fake.capture(command).await
        }
    }

    #[tokio::test]
    async fn runs_compose_on_the_app_with_its_project_its_file_and_the_global_env() {
        let (_dir, data_dir) = installed(&["alpha-app"]);
        let compose = Compose::new(data_dir.clone(), FakeRunner::new());
        // Asked in the other order, the options come in the Waku version's.
        let update = ComposeCommand::Up(UpOptions {
            force_recreate: true,
            pull: true,
        });

        compose
            .run("alpha-app", update, Output::Inherit)
            .await
            .expect("the fake run succeeds");

        let runs = compose.runner.runs();
        let file = data_dir.installed().join("alpha-app").join("compose.yml");
        let env_file = data_dir.env_file();

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].program, "docker");
        assert_eq!(
            runs[0].args,
            [
                "compose",
                "--env-file",
                env_file.to_str().expect("UTF-8"),
                "-p",
                "alpha-app",
                "-f",
                file.to_str().expect("UTF-8"),
                "up",
                "-d",
                "--pull",
                "always",
                "--force-recreate",
            ]
        );
    }

    #[tokio::test]
    async fn passes_a_command_given_as_its_arguments_as_they_are() {
        let (_dir, data_dir) = installed(&["alpha-app"]);
        let compose = Compose::new(data_dir.clone(), FakeRunner::new());
        let exec = ComposeCommand::Args(
            ["exec", "web", "sh", "-c", "echo $HOME 'quoted'"]
                .map(str::to_owned)
                .to_vec(),
        );

        compose
            .run("alpha-app", exec, Output::Inherit)
            .await
            .expect("the fake run succeeds");

        let runs = compose.runner.runs();
        let file = data_dir.installed().join("alpha-app").join("compose.yml");

        assert_eq!(
            runs[0].args,
            [
                "compose",
                "--env-file",
                data_dir.env_file().to_str().expect("UTF-8"),
                "-p",
                "alpha-app",
                "-f",
                file.to_str().expect("UTF-8"),
                "exec",
                "web",
                "sh",
                "-c",
                "echo $HOME 'quoted'",
            ]
        );
    }

    #[tokio::test]
    async fn refuses_an_app_compose_cannot_name_or_that_is_not_installed() {
        let (_dir, data_dir) = installed(&["llama.cpp"]);
        let compose = Compose::new(data_dir, FakeRunner::new());

        for app in ["llama.cpp", "../app-store", ""] {
            let error = compose
                .run(app, ComposeCommand::Down, Output::Inherit)
                .await
                .expect_err("compose cannot name the app");

            assert!(
                matches!(error, ComposeError::InvalidProject { .. }),
                "{app:?}: {error:?}"
            );
        }

        let error = compose
            .run("missing-app", ComposeCommand::Restart, Output::Inherit)
            .await
            .expect_err("the app is not installed");

        assert!(matches!(error, ComposeError::NotInstalled { ref app } if app == "missing-app"));
        assert!(compose.runner.runs().is_empty());
    }

    #[tokio::test]
    async fn fails_with_the_app_the_command_and_compose_s_stderr() {
        let (_dir, data_dir) = installed(&["alpha-app"]);
        let compose = Compose::new(data_dir, FakeRunner::new());

        compose.runner.reply(Reply::Failure {
            code: 1,
            stderr: "network hangar-main-net not found\n".into(),
        });

        let error = compose
            .run("alpha-app", ComposeCommand::Pull, Output::Inherit)
            .await
            .expect_err("the reply fails");

        assert_eq!(error.to_string(), "docker compose pull failed on alpha-app");
        assert!(matches!(
            error,
            ComposeError::Failed { source: RunError::Failed { ref stderr, .. }, .. }
                if stderr == "network hangar-main-net not found"
        ));
    }

    #[tokio::test]
    async fn validates_a_file_with_compose_config_and_returns_its_complaint() {
        let (_dir, data_dir) = installed(&[]);
        let compose = Compose::new(data_dir.clone(), FakeRunner::new());
        let file = Path::new("/data/app-store/store/web/.compose.pending.yml");

        compose
            .validate(file)
            .await
            .expect("the fake check succeeds");
        compose.runner.reply(Reply::Failure {
            code: 15,
            stderr: "services must be a mapping\n".into(),
        });

        let error = compose.validate(file).await.expect_err("the reply fails");
        let runs = compose.runner.runs();

        assert_eq!(
            runs[0].args,
            [
                "compose",
                "--env-file",
                data_dir.env_file().to_str().expect("UTF-8"),
                "-f",
                "/data/app-store/store/web/.compose.pending.yml",
                "config",
                "-q",
            ]
        );
        assert!(matches!(
            error,
            ComposeError::Invalid { source: RunError::Failed { ref stderr, .. }, .. }
                if stderr == "services must be a mapping"
        ));
    }

    #[tokio::test]
    async fn checks_a_stack_with_stack_config_and_the_global_variables_in_its_environment() {
        let (_dir, data_dir) = installed(&[]);
        let compose = Compose::new(data_dir, FakeRunner::new());
        let compose_file = Path::new("/data/app-store/store/web/compose.yml");
        let swarm_file = Path::new("/data/app-store/store/web/.compose.1-1.pending.yml");
        let variables = BTreeMap::from([("WEB_TAG".to_owned(), "1.2".to_owned())]);

        compose.runner.reply(Reply::Failure {
            code: 1,
            stderr: "depends_on must be a list\n".into(),
        });

        let error = compose
            .validate_stack(compose_file, swarm_file, &variables)
            .await
            .expect_err("the reply fails");
        let runs = compose.runner.runs();

        assert_eq!(
            runs[0].args,
            [
                "stack",
                "config",
                "-c",
                "/data/app-store/store/web/compose.yml",
                "-c",
                "/data/app-store/store/web/.compose.1-1.pending.yml",
            ]
        );
        assert_eq!(runs[0].env, variables);
        assert!(matches!(
            error,
            ComposeError::Invalid { ref file, source: RunError::Failed { ref stderr, .. } }
                if file == swarm_file && stderr == "depends_on must be a list"
        ));
    }

    #[tokio::test]
    async fn says_a_file_that_docker_could_not_check_is_unchecked_not_invalid() {
        let (_dir, data_dir) = installed(&[]);
        let compose = Compose::new(data_dir, Unstartable);
        let error = compose
            .validate(Path::new("/data/app-store/store/web/compose.yml"))
            .await
            .expect_err("docker does not start");

        assert_eq!(
            error.to_string(),
            "could not check /data/app-store/store/web/compose.yml"
        );
        assert!(matches!(
            error,
            ComposeError::Unchecked {
                source: RunError::Spawn { .. },
                ..
            }
        ));
    }

    #[tokio::test]
    async fn runs_a_batch_in_the_order_of_hangar_yml_and_down_in_reverse() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app", "gamma-app", "extra-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());
        let asked = [
            "gamma-app",
            "extra-app",
            "alpha-app",
            "beta-app",
            "alpha-app",
        ];

        for command in [
            ComposeCommand::Up(UpOptions::default()),
            ComposeCommand::Down,
        ] {
            let batch = compose
                .batch(command, &asked, &config(), OnFailure::CarryOn)
                .await
                .expect("every app is installed");

            batch.finished().await;
        }

        let runs = runner.fake.runs();

        assert_eq!(
            projects(&runs),
            [
                "alpha-app",
                "beta-app",
                "gamma-app",
                "extra-app",
                "extra-app",
                "gamma-app",
                "beta-app",
                "alpha-app",
            ]
        );
        assert_eq!(runs[0].args[7..], ["up", "-d"]);
        assert_eq!(runs[4].args[7..], ["down"]);
    }

    #[tokio::test]
    async fn refuses_a_whole_batch_when_one_app_would_be_refused() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());
        let missing = compose
            .batch(
                ComposeCommand::Restart,
                &["alpha-app", "missing-app", "beta-app"],
                &config(),
                OnFailure::CarryOn,
            )
            .await
            .expect_err("missing-app is not installed");
        let empty = compose
            .batch(
                ComposeCommand::Restart,
                &[] as &[&str],
                &config(),
                OnFailure::CarryOn,
            )
            .await
            .expect_err("no app");

        assert!(matches!(missing, ComposeError::NotInstalled { ref app } if app == "missing-app"));
        assert!(matches!(empty, ComposeError::EmptyBatch));
        assert!(runner.fake.runs().is_empty());
    }

    #[tokio::test]
    async fn refuses_an_option_before_the_command_that_would_override_the_project() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());
        let down = ComposeCommand::Args(["-p", "beta-app", "down"].map(str::to_owned).to_vec());
        let alone = compose
            .run("alpha-app", down.clone(), Output::Inherit)
            .await
            .expect_err("-p comes first");
        let batch = compose
            .batch(down, &["alpha-app", "beta-app"], &config(), OnFailure::Stop)
            .await
            .expect_err("-p comes first");

        assert_eq!(
            alone.to_string(),
            "-p comes before the compose command: put it after the command's name"
        );
        assert!(
            matches!(batch, ComposeError::OptionBeforeCommand { ref option } if option == "-p")
        );
        assert!(runner.fake.runs().is_empty());
    }

    #[tokio::test]
    async fn refuses_an_up_that_attaches_on_several_apps_and_runs_it_on_one() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());
        let attached = ComposeCommand::Args(vec!["up".into(), "--build".into()]);
        let refused = compose
            .batch(
                attached.clone(),
                &["alpha-app", "beta-app"],
                &config(),
                OnFailure::Stop,
            )
            .await
            .expect_err("an attached up runs on one app alone");

        assert_eq!(
            refused.to_string(),
            "docker compose up --build is not detached: it runs on one app alone, add -d to run it on several"
        );
        assert!(runner.fake.runs().is_empty());

        let batch = compose
            .batch(
                attached,
                &["alpha-app", "alpha-app"],
                &config(),
                OnFailure::Stop,
            )
            .await
            .expect("an app given twice is one app");

        assert_eq!(batch.finished().await.failures(), 0);
        assert_eq!(projects(&runner.fake.runs()), ["alpha-app"]);
    }

    #[tokio::test]
    async fn stops_a_batch_passed_as_its_arguments_in_reverse() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());
        let stop = ComposeCommand::Args(vec!["stop".into(), "--timeout".into(), "1".into()]);
        let batch = compose
            .batch(stop, &["alpha-app", "beta-app"], &config(), OnFailure::Stop)
            .await
            .expect("every app is installed");

        batch.finished().await;

        let runs = runner.fake.runs();

        assert_eq!(projects(&runs), ["beta-app", "alpha-app"]);
        assert_eq!(runs[0].args[7..], ["stop", "--timeout", "1"]);
    }

    #[tokio::test]
    async fn carries_on_after_an_app_that_fails_and_keeps_the_output_for_a_late_listener() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app", "gamma-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());

        runner
            .fake
            .reply(Reply::Success {
                stdout: "Container alpha-app Started\n".into(),
            })
            .reply(Reply::Failure {
                code: 1,
                stderr: "port is already allocated\n".into(),
            });

        let batch = compose
            .batch(
                ComposeCommand::Up(UpOptions::default()),
                &["alpha-app", "beta-app", "gamma-app"],
                &config(),
                OnFailure::CarryOn,
            )
            .await
            .expect("every app is installed");
        let report = batch.finished().await;
        let events: Vec<String> = batch
            .output()
            .map(|event| match event {
                BatchEvent::Started { app } => format!("started {app}"),
                BatchEvent::Output { app, line } => {
                    format!("{app}: {}", String::from_utf8_lossy(&line))
                }
                BatchEvent::Finished(outcome) => match outcome.status {
                    AppStatus::Succeeded => format!("{} succeeded", outcome.app),
                    AppStatus::Failed(error) => format!("{} failed: {error}", outcome.app),
                    AppStatus::NotRun => format!("{} not run", outcome.app),
                },
                BatchEvent::Skipped { events } => format!("skipped {events}"),
            })
            .collect()
            .await;

        assert_eq!(report.failures(), 1);
        assert_eq!(projects(&runner.fake.runs()).len(), 3);
        assert_eq!(
            events,
            [
                "started alpha-app",
                "alpha-app: Container alpha-app Started\n",
                "alpha-app succeeded",
                "started beta-app",
                "beta-app: port is already allocated\n",
                "beta-app failed: docker compose up -d failed on beta-app",
                "started gamma-app",
                "gamma-app succeeded",
            ]
        );
    }

    #[tokio::test]
    async fn goes_on_once_the_caller_and_its_listener_are_gone() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app"]);
        let runner = Gated::closed();
        let compose = Compose::new(data_dir, runner.clone());
        let (handing, handed) = oneshot::channel();

        // The caller, as the request of a page: it starts the batch, reads its first event, and goes away.
        let caller = tokio::spawn(async move {
            let batch = compose
                .batch(
                    ComposeCommand::Down,
                    &["alpha-app", "beta-app"],
                    &config(),
                    OnFailure::CarryOn,
                )
                .await
                .expect("every app is installed");
            let mut output = Box::pin(batch.output());

            handing
                .send(batch.clone())
                .expect("the test waits for the batch");
            output.next().await;
            std::future::pending::<()>().await;
        });
        let batch = handed.await.expect("the caller hands the batch");

        runner.until_arrived(1).await;
        caller.abort();
        assert!(caller.await.expect_err("aborted").is_cancelled());

        runner.let_through(2);

        let report = batch.finished().await;

        assert_eq!(report.failures(), 0);
        assert_eq!(projects(&runner.fake.runs()), ["beta-app", "alpha-app"]);
    }

    #[tokio::test]
    async fn stops_at_the_first_failure_when_asked_and_reports_the_rest_as_not_run() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app", "gamma-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());
        let apps = ["alpha-app", "beta-app", "gamma-app"];

        for command in [ComposeCommand::Restart, ComposeCommand::Down] {
            runner
                .fake
                .reply(Reply::Success {
                    stdout: String::new(),
                })
                .reply(Reply::Failure {
                    code: 1,
                    stderr: "no such service\n".into(),
                });

            let batch = compose
                .batch(command.clone(), &apps, &config(), OnFailure::Stop)
                .await
                .expect("every app is installed");
            let report = batch.finished().await;

            assert_eq!(report.failures(), 2);

            if command == ComposeCommand::Restart {
                assert_eq!(
                    statuses(&report),
                    [
                        "alpha-app succeeded",
                        "beta-app failed",
                        "gamma-app not run"
                    ]
                );
            } else {
                assert_eq!(
                    statuses(&report),
                    [
                        "gamma-app succeeded",
                        "beta-app failed",
                        "alpha-app not run"
                    ]
                );
            }
        }

        assert_eq!(
            projects(&runner.fake.runs()),
            ["alpha-app", "beta-app", "gamma-app", "beta-app"]
        );
    }

    #[tokio::test]
    async fn pulls_every_app_even_when_asked_to_stop_at_the_first_failure() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app", "gamma-app"]);
        let runner = Gated::open();
        let compose = Compose::new(data_dir, runner.clone());

        runner.fake.reply(Reply::Failure {
            code: 1,
            stderr: "pull access denied\n".into(),
        });

        let batch = compose
            .batch(
                ComposeCommand::Pull,
                &["alpha-app", "beta-app", "gamma-app"],
                &config(),
                OnFailure::Stop,
            )
            .await
            .expect("every app is installed");
        let report = batch.finished().await;

        assert_eq!(report.failures(), 1);
        assert_eq!(runner.fake.runs().len(), 3);
    }

    #[tokio::test]
    async fn fails_every_app_a_batch_whose_task_panicked_did_not_end() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app"]);
        let compose = Compose::new(data_dir, Panicking);
        let batch = compose
            .batch(
                ComposeCommand::Up(UpOptions::default()),
                &["alpha-app", "beta-app"],
                &config(),
                OnFailure::CarryOn,
            )
            .await
            .expect("every app is installed");
        let report = batch.finished().await;
        let finished: Vec<String> = batch
            .output()
            .filter_map(|event| async move {
                match event {
                    BatchEvent::Finished(outcome) => Some(outcome.app.to_string()),
                    _ => None,
                }
            })
            .collect()
            .await;

        assert_eq!(report.failures(), 2);
        assert_eq!(statuses(&report), ["alpha-app not run", "beta-app not run"]);
        assert_eq!(finished, ["alpha-app", "beta-app"]);
    }

    fn assert_send<T: Send>(_: T) {}

    #[test]
    fn returns_futures_that_are_send() {
        let data_dir = DataDir::new("/data").expect("an absolute path resolves");
        let compose = Compose::new(data_dir, Gated::open());
        let config = Config::default();

        assert_send(compose.run("web", ComposeCommand::Down, Output::Inherit));
        assert_send(compose.validate(Path::new("/data/compose.yml")));
        assert_send(compose.batch(ComposeCommand::Pull, &["web"], &config, OnFailure::Stop));
    }

    #[tokio::test]
    async fn pulls_every_app_at_once() {
        let (_dir, data_dir) = installed(&["alpha-app", "beta-app", "gamma-app"]);
        let runner = Gated::closed();
        let compose = Compose::new(data_dir, runner.clone());
        let batch = compose
            .batch(
                ComposeCommand::Pull,
                &["alpha-app", "beta-app", "gamma-app"],
                &config(),
                OnFailure::CarryOn,
            )
            .await
            .expect("every app is installed");

        // One at a time, the second run would never come to the gate before the first went through.
        runner.until_arrived(3).await;
        runner.let_through(3);

        assert_eq!(batch.finished().await.apps.len(), 3);
    }
}
