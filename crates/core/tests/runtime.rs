//! The runtime on real child processes, run by `sh -c`.

#![cfg(unix)]

use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use hangar_core::{CancellationToken, Command, CommandRunner, Output, RunError, Runtime};
use nix::sys::signal::kill;
use nix::unistd::Pid;
use tokio::sync::mpsc;

/// How long a test waits for what it checks before it fails, rather than hang.
const DEADLINE: Duration = Duration::from_secs(10);

/// A child that prints its pid, then loops until SIGTERM, which it answers by creating the file named as its first
/// argument.
const STOPS_ON_SIGTERM: &str =
    r#"trap 'touch "$1"; exit 0' TERM; echo $$; while :; do sleep 0.1; done"#;

/// A command running `script` in `sh`.
fn shell(script: &str) -> Command {
    Command::new("sh").args(["-c", script])
}

/// A channel for a streamed run, large enough for the output of a test.
fn channel() -> (mpsc::Sender<Vec<u8>>, mpsc::Receiver<Vec<u8>>) {
    mpsc::channel(64)
}

/// The messages a finished run left in the channel.
fn received(receiver: &mut mpsc::Receiver<Vec<u8>>) -> Vec<String> {
    let mut messages = Vec::new();

    while let Ok(message) = receiver.try_recv() {
        messages.push(String::from_utf8_lossy(&message).into_owned());
    }

    messages
}

/// Awaits `future`, failing the test past [`DEADLINE`].
async fn within_deadline<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(DEADLINE, future)
        .await
        .expect("the test is over before its deadline")
}

/// Whether the process whose pid a child printed still runs.
fn is_running(printed_pid: &[u8]) -> bool {
    let pid = String::from_utf8_lossy(printed_pid)
        .trim()
        .parse()
        .expect("the child printed its pid");

    kill(Pid::from_raw(pid), None).is_ok()
}

/// A file in the temporary directory, which a child creates to tell the test something; removed with it.
struct Marker(PathBuf);

impl Marker {
    fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("hangar-runtime-{}-{name}", std::process::id()));

        Self(path)
    }

    fn path(&self) -> &str {
        self.0.to_str().expect("a UTF-8 temporary directory")
    }

    fn exists(&self) -> bool {
        self.0.exists()
    }
}

impl Drop for Marker {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[tokio::test]
async fn streams_stdout_and_stderr_of_several_runs_into_one_channel() {
    let runtime = Runtime::new();
    let (sender, mut receiver) = channel();

    runtime
        .run(
            &shell("echo first; echo second >&2"),
            Output::Lines(sender.clone()),
        )
        .await
        .expect("the first run succeeds");

    // The channel survives the first child: a compose batch shares it.
    runtime
        .run(&shell("printf third"), Output::Lines(sender))
        .await
        .expect("the second run succeeds");

    let mut lines = received(&mut receiver);

    // stdout and stderr are read apart, so their order between them is the system's.
    lines[..2].sort();

    assert_eq!(lines, ["first\n", "second\n", "third"]);
}

#[tokio::test]
async fn streams_chunks_as_the_child_writes_them() {
    let runtime = Runtime::new();
    let (sender, mut receiver) = channel();

    runtime
        .run(
            &shell("printf 'Pulling'; printf ' done\\n'"),
            Output::Chunks(sender),
        )
        .await
        .expect("the run succeeds");

    assert_eq!(received(&mut receiver).concat(), "Pulling done\n");
}

#[tokio::test]
async fn fails_with_the_child_exit_code() {
    let runtime = Runtime::new();

    let failure = runtime
        .run(&shell("exit 3"), Output::Inherit)
        .await
        .expect_err("a non-zero exit fails");

    assert!(matches!(failure, RunError::Failed { code: 3, .. }));
    assert_eq!(failure.exit_code(), 3);
}

#[tokio::test]
async fn captures_stdout_without_stderr() {
    let runtime = Runtime::new();

    let stdout = runtime
        .capture(&shell(r#"echo noise >&2; echo '{"ok":true}'"#))
        .await
        .expect("the capture succeeds");

    assert_eq!(stdout, "{\"ok\":true}\n");
}

#[tokio::test]
async fn fails_a_captured_run_on_a_non_zero_exit_even_one_that_printed_something() {
    let runtime = Runtime::new();
    let script = "echo 'Creating service web'; echo 'network conflict' >&2; exit 1";

    let failure = runtime
        .capture(&shell(script))
        .await
        .expect_err("a non-zero exit fails");

    assert_eq!(
        failure.to_string(),
        "sh exited with code 1: network conflict"
    );
}

#[tokio::test]
async fn reports_the_end_of_stderr_when_a_streamed_run_fails() {
    let runtime = Runtime::new();
    let (sender, mut receiver) = channel();
    let script = "echo 'Creating service web'; echo 'this node is not a manager' >&2; exit 1";

    let failure = runtime
        .run(&shell(script), Output::Lines(sender))
        .await
        .expect_err("a non-zero exit fails");

    assert!(matches!(
        failure,
        RunError::Failed { code: 1, ref stderr, .. } if stderr == "this node is not a manager"
    ));
    assert!(received(&mut receiver).contains(&"this node is not a manager\n".to_owned()));
}

#[tokio::test]
async fn keeps_only_the_end_of_a_long_stderr_where_the_cause_is() {
    let runtime = Runtime::new();
    let script = "i=0; while [ $i -lt 5000 ]; do echo \"progress $i\" >&2; i=$((i + 1)); done; echo 'disk full' >&2; exit 1";

    let failure = runtime
        .capture(&shell(script))
        .await
        .expect_err("a non-zero exit fails");

    let RunError::Failed { stderr, .. } = failure else {
        panic!("expected a failed run, got {failure:?}");
    };

    assert_eq!(stderr.lines().count(), 20);
    assert!(stderr.starts_with("progress 4981\n"));
    assert!(stderr.ends_with("progress 4999\ndisk full"));
}

#[tokio::test]
async fn sets_the_given_variables_over_its_own_environment() {
    let runtime = Runtime::new();
    let command =
        shell(r#"echo "$HANGAR_TEST_VAR ${PATH:+inherited}""#).env("HANGAR_TEST_VAR", "set");

    let stdout = runtime
        .capture(&command)
        .await
        .expect("the capture succeeds");

    assert_eq!(stdout, "set inherited\n");
}

#[tokio::test]
async fn runs_in_the_given_directory() {
    let runtime = Runtime::new();
    let dir = std::env::temp_dir()
        .canonicalize()
        .expect("the temporary directory exists");

    let stdout = runtime
        .capture(&shell("pwd -P").current_dir(&dir))
        .await
        .expect("the capture succeeds");

    assert_eq!(stdout.trim_end(), dir.to_str().expect("a UTF-8 path"));
}

#[tokio::test]
async fn stops_the_child_with_sigterm_when_its_command_is_cancelled() {
    let runtime = Runtime::new();
    let marker = Marker::new("cancelled");
    let cancellation = CancellationToken::new();
    let (sender, mut receiver) = channel();
    let command = shell(STOPS_ON_SIGTERM)
        .args(["sh", marker.path()])
        .cancellation(cancellation.clone());

    let run = runtime.run(&command, Output::Lines(sender));
    let cancel_once_started = async {
        let pid = receiver.recv().await.expect("the child prints its pid");

        cancellation.cancel();

        pid
    };

    let (failure, pid) = within_deadline(async { tokio::join!(run, cancel_once_started) }).await;

    assert!(matches!(failure, Err(RunError::Cancelled { .. })));
    assert!(marker.exists(), "the child got SIGTERM");
    assert!(!is_running(&pid), "the child is gone");
}

#[tokio::test]
async fn stops_the_child_of_a_dropped_run_and_counts_it_until_then() {
    let runtime = Runtime::new();
    let marker = Marker::new("dropped");
    let (sender, mut receiver) = channel();
    let command = shell(STOPS_ON_SIGTERM).args(["sh", marker.path()]);
    let running = runtime.clone();

    let run = tokio::spawn(async move { running.run(&command, Output::Lines(sender)).await });
    let pid = within_deadline(receiver.recv())
        .await
        .expect("the child prints its pid");

    run.abort();
    within_deadline(runtime.idle()).await;

    assert!(marker.exists(), "the child got SIGTERM");
    assert!(!is_running(&pid), "the child is gone");
}

#[tokio::test]
async fn a_cancelled_runtime_stops_its_children_and_starts_no_other() {
    let cancellation = CancellationToken::new();
    let runtime = Runtime::with_cancellation(cancellation.clone());
    let (sender, mut receiver) = channel();

    let command = shell("echo $$; exec sleep 60");

    let run = runtime.run(&command, Output::Lines(sender));
    let cancel_once_started = async {
        let pid = receiver.recv().await.expect("the child prints its pid");

        cancellation.cancel();

        pid
    };

    let (stopped, pid) = within_deadline(async { tokio::join!(run, cancel_once_started) }).await;
    let refused = runtime
        .capture(&shell("echo never"))
        .await
        .expect_err("the runtime was cancelled before the run");

    assert!(matches!(stopped, Err(RunError::Cancelled { .. })));
    assert!(!is_running(&pid), "the child is gone");
    assert!(matches!(refused, RunError::Cancelled { .. }));
}

#[tokio::test]
async fn an_interrupted_runtime_refuses_new_runs_and_lets_the_running_ones_end() {
    let runtime = Runtime::new();
    let marker = Marker::new("interrupted");
    let (sender, mut receiver) = channel();

    // The child runs until the test creates the marker, after the interruption.
    let command = shell(r#"echo started; while [ ! -e "$1" ]; do sleep 0.01; done"#)
        .args(["sh", marker.path()]);

    let run = runtime.run(&command, Output::Lines(sender));
    let interrupt_once_started = async {
        receiver.recv().await.expect("the child says it started");
        runtime.interrupt();

        let refused = runtime.capture(&shell("echo never")).await;

        std::fs::write(&marker.0, "").expect("the marker can be created");

        refused
    };

    let (ended, refused) =
        within_deadline(async { tokio::join!(run, interrupt_once_started) }).await;

    within_deadline(runtime.idle()).await;

    ended.expect("the running child ends on its own");

    let refused = refused.expect_err("a run after the interruption is refused");

    assert!(matches!(refused, RunError::Interrupted { .. }));
    assert_eq!(refused.exit_code(), 130);
}

#[tokio::test]
async fn ends_a_run_whose_grandchild_holds_the_pipes_open() {
    let runtime = Runtime::new();

    // The grandchild keeps stdout and stderr open for 5 seconds after the child exits.
    let stdout = within_deadline(runtime.capture(&shell("(sleep 5) & echo done")))
        .await
        .expect("the child succeeded");

    assert_eq!(stdout, "done\n");
}

#[tokio::test]
async fn keeps_the_exit_status_when_a_cancel_comes_after_the_exit() {
    let runtime = Runtime::new();
    let cancellation = CancellationToken::new();
    let (sender, mut receiver) = channel();

    // The grandchild holds the pipes, and says once the runtime has reaped the child.
    let script = "parent=$$; (while kill -0 $parent 2>/dev/null; do sleep 0.01; done; echo reaped; sleep 5) & exit 4";
    let command = shell(script).cancellation(cancellation.clone());

    let run = runtime.run(&command, Output::Lines(sender));
    let cancel_once_reaped = async {
        let line = receiver.recv().await.expect("the grandchild prints");

        cancellation.cancel();

        line
    };

    let (failure, line) = within_deadline(async { tokio::join!(run, cancel_once_reaped) }).await;

    assert_eq!(line, b"reaped\n");
    assert!(matches!(failure, Err(RunError::Failed { code: 4, .. })));
}

#[tokio::test]
async fn reports_a_child_killed_by_a_signal() {
    let runtime = Runtime::new();

    let failure = runtime
        .capture(&shell("kill -9 $$"))
        .await
        .expect_err("a killed child fails");

    assert!(matches!(
        failure,
        RunError::Killed {
            signal: Some(9),
            ..
        }
    ));
    assert_eq!(failure.exit_code(), 137);
}

#[tokio::test]
async fn reports_a_program_that_does_not_start() {
    let runtime = Runtime::new();

    let failure = runtime
        .run(&Command::new("hangar-no-such-program"), Output::Inherit)
        .await
        .expect_err("a missing program fails");

    assert!(matches!(failure, RunError::Spawn { .. }));
    assert_eq!(failure.to_string(), "could not run hangar-no-such-program");
}

#[tokio::test]
async fn rejects_a_captured_stdout_that_is_not_utf8() {
    let runtime = Runtime::new();

    let failure = runtime
        .capture(&shell(r"printf '\377'"))
        .await
        .expect_err("the output is not UTF-8");

    assert!(matches!(failure, RunError::NotUtf8 { .. }));
}
