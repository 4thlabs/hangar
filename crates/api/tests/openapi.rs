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

#[test]
fn every_route_but_signing_in_and_health_takes_a_session() {
    let document: Value = serde_json::from_str(&hangar_api::Api::openapi().to_json_pretty())
        .expect("the document is JSON");
    let paths = document["paths"]
        .as_object()
        .expect("the document has paths");
    let open = |path: &str| path.starts_with("/api/auth/") || path == "/api/health";

    for (path, operations) in paths.iter().filter(|(path, _)| !open(path)) {
        for (method, operation) in operations.as_object().expect("a path's operations") {
            assert_eq!(
                operation["security"],
                serde_json::json!([{ "Session": [] }]),
                "{method} {path} takes no session: give its group `#[auth(crate::Session)]`"
            );
        }
    }
}
