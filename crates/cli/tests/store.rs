//! `hangar store`, as a shell runs it: against a fake `docker` first in the `PATH`, a script that logs each call and
//! prints a line, and a local git repository for the store.

#![cfg(unix)]

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use nix::sys::signal::{Signal, killpg};
use nix::unistd::Pid;
use tempfile::TempDir;

/// The fake `docker`: it logs its arguments, one call per line, and its environment, then prints `<project> done`. It
/// fails with code 3 on the project `HANGAR_TEST_FAIL` names, prints its stdin on `HANGAR_TEST_STDIN`'s, and prints
/// `<project> started` then sleeps on `HANGAR_TEST_HANG`'s, on `HANGAR_TEST_GRACEFUL`'s until SIGINT, on which it
/// exits with 0, on `HANGAR_TEST_DEAF`'s with SIGINT ignored, and on `HANGAR_TEST_STUBBORN`'s with SIGTERM ignored
/// too.
const FAKE_DOCKER: &str = r#"#!/bin/sh
echo "$*" >> "$HANGAR_TEST_LOG"
env > "$HANGAR_TEST_LOG.env"
project=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "-p" ]; then project="$arg"; fi
  previous="$arg"
done
case "$project" in
  "${HANGAR_TEST_FAIL:-none}") echo "$project: no such image" >&2; exit 3 ;;
  "${HANGAR_TEST_STDIN:-none}") exec cat ;;
  "${HANGAR_TEST_GRACEFUL:-none}") trap 'kill $!; exit 0' INT; echo "$project started"; sleep 30 & wait ;;
  "${HANGAR_TEST_HANG:-none}") echo "$project started"; exec sleep 30 ;;
  "${HANGAR_TEST_DEAF:-none}") trap '' INT; echo "$project started"; exec sleep 30 ;;
  "${HANGAR_TEST_STUBBORN:-none}") trap '' INT TERM; echo "$project started"; exec sleep 30 ;;
esac
echo "$project done"
"#;

/// The time a child has between SIGTERM and SIGKILL, which a third Ctrl-C does not wait for.
const GRACE: Duration = Duration::from_secs(10);

/// The categories: `traefik` in both, listed first.
const CONFIG: &str = "
categories:
  - { name: Network, color: blue, stacks: [traefik, gluetun] }
  - { name: Media, color: purple, stacks: [traefik, jellyfin] }
";

/// A data directory with the apps of [`CONFIG`] installed, the fake `docker`, and the log of its calls.
struct Fixture {
    dir: TempDir,
    data: PathBuf,
    bin: PathBuf,
    log: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let data = dir.path().join("data");
        let bin = dir.path().join("bin");
        let log = dir.path().join("docker.log");
        let config = data.join("app-store/config");

        fs::create_dir_all(&config).expect("the config folder can be made");
        fs::write(config.join("hangar.yml"), CONFIG).expect("hangar.yml can be written");

        for app in ["traefik", "gluetun", "jellyfin"] {
            let folder = data.join("app-installed").join(app);

            fs::create_dir_all(&folder).expect("the app's folder can be made");
            fs::write(folder.join("compose.yml"), "services: {}\n")
                .expect("the compose file can be written");
        }

        fs::create_dir_all(&bin).expect("the bin folder can be made");
        fs::write(bin.join("docker"), FAKE_DOCKER).expect("the fake docker can be written");
        fs::set_permissions(bin.join("docker"), fs::Permissions::from_mode(0o755))
            .expect("the fake docker can be made executable");

        Self {
            dir,
            data,
            bin,
            log,
        }
    }

    /// `hangar` with `args`, in the fixture's folder, which has no `.env`, its data directory set.
    fn hangar(&self, args: &[&str]) -> Command {
        let mut command = self.bare(args);

        command.env("HANGAR_DATA_DIR", &self.data);
        command
    }

    /// `hangar` with `args`, in the fixture's folder, with no variable of Hangar set.
    fn bare(&self, args: &[&str]) -> Command {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![self.bin.clone()];

        paths.extend(std::env::split_paths(&path));

        let mut command = Command::new(env!("CARGO_BIN_EXE_hangar"));

        command
            .args(args)
            .current_dir(self.dir.path())
            .env_remove("HANGAR_DATA_DIR")
            .env_remove("HANGAR_STORE_URL")
            .env("PATH", std::env::join_paths(paths).expect("the PATH joins"))
            .env("HANGAR_TEST_LOG", &self.log);
        command
    }

    /// The calls of the fake `docker`, in order.
    fn calls(&self) -> Vec<String> {
        fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// The projects of the calls, read off their `-p`, in order.
    fn projects(&self) -> Vec<String> {
        self.calls()
            .iter()
            .filter_map(|call| {
                let mut words = call.split(' ').skip_while(|word| *word != "-p");

                words.nth(1).map(str::to_owned)
            })
            .collect()
    }

    /// The call of `docker compose` on `app`, ending with `command`.
    fn call(&self, app: &str, command: &str) -> String {
        let data = self.data.display();

        format!(
            "compose --env-file {data}/.env.global -p {app} -f {data}/app-installed/{app}/compose.yml {command}"
        )
    }
}

fn run(command: &mut Command) -> Output {
    command
        .output()
        .expect("the binary was built for this test")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn brings_every_listed_app_up_in_order_and_prints_their_output() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "up", "--pull", "always"]));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        fixture.calls(),
        ["traefik", "gluetun", "jellyfin"].map(|app| fixture.call(app, "up -d --pull always"))
    );
    assert_eq!(
        stdout(&output),
        "traefik done\ngluetun done\njellyfin done\n"
    );
}

#[test]
fn takes_a_category_down_in_reverse_order() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "Media", "down"]));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(fixture.projects(), ["jellyfin", "traefik"]);
}

#[test]
fn runs_a_command_on_one_app() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "jellyfin", "up", "-d", "--force-recreate"]));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        fixture.calls(),
        [fixture.call("jellyfin", "up -d --force-recreate")]
    );
}

#[test]
fn passes_an_up_without_d_through_on_one_app_and_compose_alone_for_no_command() {
    let fixture = Fixture::new();

    let up = run(&mut fixture.hangar(&["store", "jellyfin", "up"]));
    let alone = run(&mut fixture.hangar(&["store", "jellyfin"]));

    assert!(up.status.success(), "{}", stderr(&up));
    assert!(alone.status.success(), "{}", stderr(&alone));
    assert_eq!(
        fixture.calls(),
        [
            fixture.call("jellyfin", "up"),
            fixture.call("jellyfin", "").trim_end().to_owned(),
        ]
    );
}

#[test]
fn refuses_an_option_before_the_command_that_would_change_the_project() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "jellyfin", "-p", "traefik", "down"]));

    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output)
            .contains("-p comes before the compose command: put it after the command's name"),
        "{}",
        stderr(&output)
    );
    assert!(fixture.calls().is_empty());
}

#[test]
fn pulls_every_listed_app() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "pull"]));
    let mut projects = fixture.projects();

    projects.sort();

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(projects, ["gluetun", "jellyfin", "traefik"]);
}

#[test]
fn stops_at_the_first_failure_and_exits_with_its_code() {
    let fixture = Fixture::new();

    let output = run(fixture
        .hangar(&["store", "up"])
        .env("HANGAR_TEST_FAIL", "gluetun"));

    assert_eq!(output.status.code(), Some(3));
    assert_eq!(fixture.projects(), ["traefik", "gluetun"]);
    assert!(
        stdout(&output).contains("gluetun: no such image"),
        "compose's stderr is printed with its output"
    );
    assert!(
        stderr(&output).contains("docker compose up -d failed on gluetun, exit 3"),
        "{}",
        stderr(&output)
    );
    assert!(
        !stderr(&output).contains("no such image"),
        "compose's stderr is not repeated: {}",
        stderr(&output)
    );
}

#[test]
fn refuses_an_app_that_is_not_installed() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "miniflux", "up", "-d"]));

    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("the app miniflux is not installed"));
    assert!(fixture.calls().is_empty());
}

#[test]
fn passes_any_other_command_through_on_one_app_with_the_terminal() {
    let fixture = Fixture::new();
    let mut child = fixture
        .hangar(&["store", "jellyfin", "exec", "web", "sh", "-c", "echo $HOME"])
        .env("HANGAR_TEST_STDIN", "jellyfin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary was built for this test");

    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(b"typed in the terminal\n")
        .expect("the binary's stdin can be written");

    let output = child.wait_with_output().expect("the binary exits");

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), "typed in the terminal\n");
    assert_eq!(
        fixture.calls(),
        [fixture.call("jellyfin", "exec web sh -c echo $HOME")]
    );
}

#[test]
fn exits_with_the_code_of_a_command_passed_through_its_stderr_left_on_the_terminal() {
    let fixture = Fixture::new();

    let output = run(fixture
        .hangar(&["store", "jellyfin", "logs", "--since", "2 hours"])
        .env("HANGAR_TEST_FAIL", "jellyfin"));

    assert_eq!(output.status.code(), Some(3));
    assert_eq!(stdout(&output), "");
    assert!(
        stderr(&output).contains("jellyfin: no such image"),
        "{}",
        stderr(&output)
    );
    assert!(
        stderr(&output)
            .contains("docker compose logs --since '2 hours' failed on jellyfin, exit 3"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn passes_a_command_through_on_several_apps_in_the_order_of_its_name() {
    let fixture = Fixture::new();

    let stop = run(&mut fixture.hangar(&["store", "Media", "stop", "--timeout", "1"]));
    let start = run(&mut fixture.hangar(&["store", "Media", "start"]));

    assert!(stop.status.success(), "{}", stderr(&stop));
    assert!(start.status.success(), "{}", stderr(&start));
    assert_eq!(
        fixture.projects(),
        ["jellyfin", "traefik", "traefik", "jellyfin"]
    );
    assert_eq!(
        fixture.calls()[0],
        fixture.call("jellyfin", "stop --timeout 1")
    );
    assert_eq!(stop.stdout, b"jellyfin done\ntraefik done\n");
}

#[test]
fn passes_the_arguments_of_store_up_and_down_through_up_detached() {
    let fixture = Fixture::new();

    let up = run(&mut fixture.hangar(&["store", "up", "--build"]));
    let down = run(&mut fixture.hangar(&["store", "down", "--volumes"]));

    assert!(up.status.success(), "{}", stderr(&up));
    assert!(down.status.success(), "{}", stderr(&down));
    assert_eq!(
        fixture.calls(),
        [
            fixture.call("traefik", "up -d --build"),
            fixture.call("gluetun", "up -d --build"),
            fixture.call("jellyfin", "up -d --build"),
            fixture.call("jellyfin", "down --volumes"),
            fixture.call("gluetun", "down --volumes"),
            fixture.call("traefik", "down --volumes"),
        ]
    );
}

#[test]
fn refuses_an_up_that_attaches_on_several_apps() {
    let fixture = Fixture::new();

    for line in [
        &["store", "Media", "up"][..],
        &["store", "Media", "up", "--build"],
    ] {
        let output = run(&mut fixture.hangar(line));

        assert_eq!(output.status.code(), Some(1));
        assert!(
            stderr(&output).contains("is not detached: it runs on one app alone"),
            "{}",
            stderr(&output)
        );
    }

    let detached = run(&mut fixture.hangar(&["store", "Media", "up", "--wait"]));

    assert!(detached.status.success(), "{}", stderr(&detached));
    assert_eq!(
        fixture.calls(),
        [
            fixture.call("traefik", "up --wait"),
            fixture.call("jellyfin", "up --wait")
        ]
    );
}

#[test]
fn lists_the_compose_projects_with_its_arguments() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.bare(&["store", "ls", "-a"]));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(fixture.calls(), ["compose ls -a"]);
}

#[test]
fn needs_the_data_directory_for_compose() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.bare(&["store", "up"]));

    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("HANGAR_DATA_DIR is not set"));
}

#[test]
fn reads_the_env_file_of_the_working_directory_after_the_environment() {
    let fixture = Fixture::new();

    fs::write(
        fixture.dir.path().join(".env"),
        format!("HANGAR_DATA_DIR=\"{}\"\n", fixture.data.display()),
    )
    .expect(".env can be written");

    let from_file = run(&mut fixture.bare(&["store", "jellyfin", "restart"]));
    let from_environment = run(fixture
        .bare(&["store", "traefik", "restart"])
        .env("HANGAR_DATA_DIR", fixture.dir.path().join("elsewhere")));

    assert!(from_file.status.success(), "{}", stderr(&from_file));
    assert_eq!(from_environment.status.code(), Some(1));
    assert!(stderr(&from_environment).contains("the app traefik is not installed"));
    assert_eq!(fixture.projects(), ["jellyfin"]);
}

#[test]
fn passes_the_env_file_on_to_the_children_as_dotenv_reads_it() {
    let fixture = Fixture::new();

    fs::write(
        fixture.dir.path().join(".env"),
        format!(
            "BROKEN LINE\n\
             HANGAR_DATA_DIR=\"{}\"\n\
             TRAEFIK_AUTH=\"admin:$apr1$abc\"\n\
             TEST_PASSWORD=pa$word\n\
             TEST_QUOTED='single $HOME # kept'\n\
             TEST_OVERRIDDEN=from-file\n",
            fixture.data.display()
        ),
    )
    .expect(".env can be written");

    let output = run(fixture
        .bare(&["store", "jellyfin", "restart"])
        .env("TEST_OVERRIDDEN", "from-environment"));
    let environment = fs::read_to_string(fixture.log.with_extension("log.env"))
        .expect("the fake docker logs its environment");
    let lines: Vec<&str> = environment.lines().collect();

    assert!(output.status.success(), "{}", stderr(&output));
    assert!(
        lines.contains(&"TRAEFIK_AUTH=admin:$apr1$abc"),
        "{environment}"
    );
    assert!(lines.contains(&"TEST_PASSWORD=pa$word"), "{environment}");
    assert!(
        lines.contains(&"TEST_QUOTED=single $HOME # kept"),
        "{environment}"
    );
    assert!(
        lines.contains(&"TEST_OVERRIDDEN=from-environment"),
        "{environment}"
    );
}

/// `hangar` run in a process group of its own, as a terminal's foreground job, its output piped.
fn spawn_in_its_own_group(command: &mut Command) -> Child {
    command
        .process_group(0)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary was built for this test")
}

/// Sends SIGINT to the group of `child`, as a terminal's Ctrl-C does to its foreground job.
fn ctrl_c(child: &Child) {
    let group = Pid::from_raw(i32::try_from(child.id()).expect("a pid fits an i32"));

    killpg(group, Signal::SIGINT).expect("the group can be signaled");
}

/// Reads `lines` until one contains `text`.
fn wait_for(lines: &mut impl Iterator<Item = std::io::Result<String>>, text: &str) {
    let found = lines
        .map(|line| line.expect("the output is UTF-8"))
        .any(|line| line.contains(text));

    assert!(found, "{text:?} was printed");
}

#[test]
fn a_first_ctrl_c_ends_the_running_app_and_starts_no_other() {
    let fixture = Fixture::new();
    let mut child = spawn_in_its_own_group(
        fixture
            .hangar(&["store", "up"])
            .env("HANGAR_TEST_HANG", "traefik"),
    );
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();

    wait_for(&mut stdout, "traefik started");
    ctrl_c(&child);

    let status = child.wait().expect("the binary exits");

    assert_eq!(status.code(), Some(130));
    assert_eq!(fixture.projects(), ["traefik"]);
}

#[test]
fn a_ctrl_c_reaches_a_command_passed_through_which_ends_on_it() {
    let fixture = Fixture::new();
    let mut child = spawn_in_its_own_group(
        fixture
            .hangar(&["store", "jellyfin", "logs", "-f"])
            .env("HANGAR_TEST_HANG", "jellyfin"),
    );
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();

    wait_for(&mut stdout, "jellyfin started");
    ctrl_c(&child);

    let output = child.wait_with_output().expect("the binary exits");

    assert_eq!(output.status.code(), Some(130));
    assert_eq!(stderr(&output), "", "the Ctrl-C was the child's");
    assert_eq!(fixture.calls(), [fixture.call("jellyfin", "logs -f")]);
}

#[test]
fn exits_with_the_code_of_a_command_passed_through_that_ends_well_on_ctrl_c() {
    let fixture = Fixture::new();
    let mut child = spawn_in_its_own_group(
        fixture
            .hangar(&["store", "jellyfin", "up"])
            .env("HANGAR_TEST_GRACEFUL", "jellyfin"),
    );
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();

    wait_for(&mut stdout, "jellyfin started");
    ctrl_c(&child);

    let output = child.wait_with_output().expect("the binary exits");

    assert_eq!(output.status.code(), Some(0));
    assert_eq!(stderr(&output), "", "the Ctrl-C was the child's");
}

#[test]
fn a_second_ctrl_c_stops_an_app_that_ignores_the_first() {
    let fixture = Fixture::new();
    let mut child = spawn_in_its_own_group(
        fixture
            .hangar(&["store", "up"])
            .env("HANGAR_TEST_DEAF", "traefik"),
    );
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr is piped")).lines();

    wait_for(&mut stdout, "traefik started");
    ctrl_c(&child);
    wait_for(&mut stderr, "Ctrl-C again stops them");
    ctrl_c(&child);

    let status = child.wait().expect("the binary exits");

    assert_eq!(status.code(), Some(130));
    assert_eq!(fixture.projects(), ["traefik"]);
}

#[test]
fn a_third_ctrl_c_exits_without_waiting_for_an_app_that_ignores_the_second() {
    let fixture = Fixture::new();
    let mut child = spawn_in_its_own_group(
        fixture
            .hangar(&["store", "up"])
            .env("HANGAR_TEST_STUBBORN", "traefik"),
    );
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr is piped")).lines();

    wait_for(&mut stdout, "traefik started");
    ctrl_c(&child);
    wait_for(&mut stderr, "Ctrl-C again stops them");
    ctrl_c(&child);
    wait_for(&mut stderr, "Ctrl-C again exits without waiting");

    let third = Instant::now();

    ctrl_c(&child);

    let status = child.wait().expect("the binary exits");

    assert_eq!(status.code(), Some(130));
    assert!(
        third.elapsed() < GRACE,
        "the binary exits before the grace period ends"
    );
}

/// A store repository with `web`, whose compose file references `WEB_PORT`, in a category.
fn store_repository(dir: &Path) -> PathBuf {
    let repository = dir.join("store.git");
    let git = |args: &[&str]| {
        let status = Command::new("git")
            .args([
                "-c",
                "user.name=Hangar",
                "-c",
                "user.email=hangar@example.com",
            ])
            .args(["-c", "init.defaultBranch=main"])
            .arg("-C")
            .arg(&repository)
            .args(args)
            .stdout(Stdio::null())
            .status()
            .expect("git runs");

        assert!(status.success(), "git {args:?} succeeds");
    };

    fs::create_dir_all(repository.join("config")).expect("the config folder can be made");
    fs::create_dir_all(repository.join("store/web")).expect("the app's folder can be made");
    fs::write(
        repository.join("config/hangar.yml"),
        "categories:\n  - { name: Web, color: blue, stacks: [web] }\n",
    )
    .expect("hangar.yml can be written");
    fs::write(
        repository.join("store/web/compose.yml"),
        "services:\n  web:\n    image: nginx\n    ports: [\"${WEB_PORT}:80\"]\n",
    )
    .expect("the compose file can be written");

    git(&["init", "--quiet"]);
    git(&["add", "."]);
    git(&["commit", "--quiet", "-m", "the store"]);

    repository
}

#[test]
fn installs_the_store_then_updates_it() {
    let fixture = Fixture::new();
    let repository = store_repository(fixture.dir.path());
    let data = fixture.dir.path().join("fresh");
    let install = || {
        run(fixture
            .bare(&["store", "install"])
            .env("HANGAR_DATA_DIR", &data)
            .env("HANGAR_STORE_URL", &repository))
    };

    let cloned = install();
    let pulled = install();

    assert!(cloned.status.success(), "{}", stderr(&cloned));
    assert!(pulled.status.success(), "{}", stderr(&pulled));
    assert!(
        data.join("app-installed/web")
            .symlink_metadata()
            .expect("web is linked")
            .is_symlink()
    );
    assert!(
        fs::read_to_string(data.join(".env.global"))
            .expect(".env.global is written")
            .contains("WEB_PORT")
    );
}

#[test]
fn needs_the_store_url_to_install() {
    let fixture = Fixture::new();

    let output = run(&mut fixture.hangar(&["store", "install"]));

    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("HANGAR_STORE_URL is not set"));
}
