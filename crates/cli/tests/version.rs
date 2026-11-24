//! The binary as a shell runs it.

use std::process::Command;

#[test]
fn prints_the_core_version() {
    let output = Command::new(env!("CARGO_BIN_EXE_hangar"))
        .arg("--version")
        .output()
        .expect("the binary was built for this test");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!("hangar {}\n", hangar_core::VERSION)
    );
}
