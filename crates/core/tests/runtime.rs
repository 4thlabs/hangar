//! The runtime on real child processes, run by `sh -c`.

use std::sync::{Arc, Mutex};

use hangar_core::{
    CancellationToken, Command, CommandRunner, Output, OutputSink, RunError, Runtime,
};

/// A command running `script` in `sh`.
fn shell(script: &str) -> Command {
    Command::new("sh").args(["-c", script])
}

/// A sink keeping each write apart, and what it received.
fn recording_sink() -> (Arc<dyn OutputSink>, Arc<Mutex<Vec<String>>>) {
    let writes = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&writes);
    let sink = Arc::new(move |output: &[u8]| {
        recorded
            .lock()
            .expect("no test panics while holding the lock")
            .push(String::from_utf8_lossy(output).into_owned());
    });

    (sink, writes)
}

#[tokio::test]
async fn streams_stdout_and_stderr_of_several_runs_into_one_sink() {
    let runtime = Runtime::new();
    let (sink, lines) = recording_sink();

    runtime
        .run(
            &shell("echo first; echo second >&2"),
            Output::Lines(Arc::clone(&sink)),
        )
        .await
        .expect("the first run succeeds");

    // The sink survives the first child: a compose batch shares it.
    runtime
        .run(&shell("printf third"), Output::Lines(sink))
        .await
        .expect("the second run succeeds");

    let mut lines = lines.lock().expect("the runs are over").clone();

    // stdout and stderr are read apart, so their order between them is the system's.
    lines[..2].sort();

    assert_eq!(lines, ["first\n", "second\n", "third"]);
}

#[tokio::test]
async fn streams_chunks_as_the_child_writes_them() {
    let runtime = Runtime::new();
    let (sink, chunks) = recording_sink();

    runtime
        .run(
            &shell("printf 'Pulling'; printf ' done\\n'"),
            Output::Chunks(sink),
        )
        .await
        .expect("the run succeeds");

    assert_eq!(
        chunks.lock().expect("the run is over").concat(),
        "Pulling done\n"
    );
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
    let (sink, lines) = recording_sink();
    let script = "echo 'Creating service web'; echo 'this node is not a manager' >&2; exit 1";

    let failure = runtime
        .run(&shell(script), Output::Lines(sink))
        .await
        .expect_err("a non-zero exit fails");

    assert!(matches!(
        failure,
        RunError::Failed { code: 1, ref stderr, .. } if stderr == "this node is not a manager"
    ));
    assert!(
        lines
            .lock()
            .expect("the run is over")
            .contains(&"this node is not a manager\n".to_owned())
    );
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
async fn kills_the_child_when_its_command_is_cancelled() {
    let runtime = Runtime::new();
    let cancellation = CancellationToken::new();
    let started = cancellation.clone();

    // Cancelled once the child says it runs: it would sleep for a minute otherwise.
    let sink = Arc::new(move |line: &[u8]| {
        if line == b"started\n" {
            started.cancel();
        }
    });
    let command = shell("echo started; exec sleep 60").cancellation(cancellation);

    let failure = runtime
        .run(&command, Output::Lines(sink))
        .await
        .expect_err("a cancelled run fails");

    assert!(matches!(failure, RunError::Cancelled { .. }));
    assert_eq!(failure.exit_code(), 130);
}

#[tokio::test]
async fn a_cancelled_runtime_kills_its_children_and_starts_no_other() {
    let cancellation = CancellationToken::new();
    let runtime = Runtime::with_cancellation(cancellation.clone());
    let sink = Arc::new(move |line: &[u8]| {
        if line == b"started\n" {
            cancellation.cancel();
        }
    });

    let killed = runtime
        .run(&shell("echo started; exec sleep 60"), Output::Lines(sink))
        .await
        .expect_err("the runtime was cancelled during the run");
    let refused = runtime
        .capture(&shell("echo never"))
        .await
        .expect_err("the runtime was cancelled before the run");

    assert!(matches!(killed, RunError::Cancelled { .. }));
    assert!(matches!(refused, RunError::Cancelled { .. }));
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
