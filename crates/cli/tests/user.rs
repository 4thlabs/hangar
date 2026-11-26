//! `hangar user hash`, as a script runs it: the password piped on stdin.

use std::io::Write;
use std::process::{Command, Output, Stdio};

use hangar_core::PasswordHash;

/// `hangar user hash`, run in an empty directory with `stdin` piped in.
fn hash(stdin: &str) -> Output {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let mut child = Command::new(env!("CARGO_BIN_EXE_hangar"))
        .args(["user", "hash"])
        .current_dir(dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary was built for this test");

    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(stdin.as_bytes())
        .expect("written");

    child.wait_with_output().expect("the binary ends")
}

#[test]
fn prints_a_hash_that_checks_the_password_read_on_stdin() {
    let output = hash("correct horse battery\n");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8");
    let printed = stdout.strip_suffix('\n').expect("one line");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(printed.starts_with("$argon2id$"), "{printed}");

    let hash = PasswordHash::parse(printed).expect("hangar.yml takes it");

    assert!(hash.verify("correct horse battery"));
}

#[test]
fn refuses_a_password_too_short() {
    let output = hash("short\n");

    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("a password is 8 to 128 characters long"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
