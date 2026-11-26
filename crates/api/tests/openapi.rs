//! The OpenAPI document against its snapshot, so that a change to the contract shows in the diff of its pull request.

use serde_json::Value;

const SNAPSHOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/openapi.snapshot.json");

#[test]
fn the_document_is_the_snapshot() {
    let written = hangar_api::Api::openapi().to_json_pretty() + "\n";

    if std::env::var_os("SNAPSHOT").is_some_and(|value| value == "overwrite") {
        std::fs::write(SNAPSHOT, &written).expect("the snapshot is written");
        return;
    }

    let snapshot = std::fs::read_to_string(SNAPSHOT)
        .expect("the snapshot is there: write it with SNAPSHOT=overwrite");
    // Compared as JSON, so that the order of the keys, which a feature of serde_json changes, does not count.
    let expected: Value = serde_json::from_str(&snapshot).expect("the snapshot is JSON");
    let actual: Value = serde_json::from_str(&written).expect("the document is JSON");

    assert!(
        actual == expected,
        "the document is not the snapshot: run `SNAPSHOT=overwrite cargo test -p hangar-api --test openapi` and review its diff"
    );
}
