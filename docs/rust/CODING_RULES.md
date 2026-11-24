# Rust coding rules

Hangar's server is rewritten in Rust, in the Cargo workspace at the root of the repository, edition 2024, built with
the latest stable Rust. The rules follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) and
the [style guide](https://doc.rust-lang.org/style-guide/). Where they say it already, this file does not repeat them.

They are adapted from [quoll's](https://github.com/4thlabs/quoll/blob/main/docs/CODING_RULES.md), the REST toolkit
the server will be built on. Two parts of quoll's are its own and do not apply here: the rules of its macro, `api!`,
whose generated code names `::quoll::...` and calls the `#[doc(hidden)]` module `quoll::__private`, and its
compile-fail tests of that macro, with trybuild. Hangar writes no proc macro, and a contract it writes with quoll
follows quoll's docs.

## Tooling

- `cargo fmt` with the default configuration. There is no `rustfmt.toml`: the code looks like every other Rust crate.
- `cargo clippy --all-targets -- -D warnings` passes. A lint is allowed only on the item that needs it, with
  `#[expect(clippy::..., reason = "...")]`, never for the whole crate.
- The workspace's lints in `Cargo.toml` hold `unsafe_code = "forbid"` and `missing_docs = "warn"`. Each crate
  inherits them with `[lints] workspace = true`, and CI turns the warnings into errors.
- `rust-version` in `Cargo.toml` states the minimum Rust. It is set at the first release and raised only in a minor
  version.

## Crates and modules

- Each crate sits in `crates/<name>`, which `members = ["crates/*"]` picks up. Their shared settings and the
  versions of the dependencies two crates use are in the root's `[workspace.package]` and `[workspace.dependencies]`.
- `hangar-core` (`crates/core`) holds what Hangar does: running commands, the store, compose and Docker. It depends
  on no web framework, so that the binary and the server both run on it, and on quoll with its feature `client`
  alone, never `server`: the APIs it calls, as Docker's Engine API, are quoll contracts. `hangar-cli` (`crates/cli`)
  is the binary `hangar`, on the core.
- One subject per module, in `name.rs`, with its submodules in `name/`. There is no `mod.rs`.
- `lib.rs` holds the crate's docs, its modules and what it re-exports; the code lives in the modules. `main.rs`
  holds `main`, which calls the rest.
- What users name is re-exported where they look for it: `hangar_core::Store`, not `hangar_core::store::Store`.
  Everything else is `pub(crate)` or private.
- Features are additive and off by default. Code behind a feature carries `#[cfg(feature = "...")]` on the module
  rather than on each item.
- A dependency stays out of the core's public signatures, so that it can be replaced, unless the caller must hold
  its type, as a `CancellationToken` it cancels.
- No `unsafe`. A need for it goes to the maintainer first.

## API

- Names follow the guidelines: `UpperCamelCase` types and traits, `snake_case` functions and modules,
  `SCREAMING_SNAKE` constants. Conversions are `as_`, `to_` and `into_`; getters take no `get_`; constructors are
  `new` or `with_...`.
- Public types derive what they can: `Debug` always, then `Clone`, `PartialEq`, `Eq`, `Hash` and `Default` where
  they mean something. They are `Send` and `Sync` where they can be, and the futures the API returns are `Send`.
- What outlives a call owns what it needs. A public type borrows only when it is a view, and a caller never has to
  keep a value alive for the library.
- A function takes what it reads as `&str`, `&Path` or `&[T]`, and what it keeps as `impl Into<String>` or by value.
- A unit of work takes what it calls through a trait, a runner of commands, a Docker client, so that a test passes
  a fake one instead of running the real thing.
- Async functions in traits are native, written `fn ... -> impl Future<Output = ...> + Send` where they must be
  `Send`. The `async-trait` crate is not used.
- Nothing blocks in async code. Work that blocks goes through `tokio::task::spawn_blocking`.

## Errors

- A failure a caller can cause is a `Result`, never a panic. `unwrap` and `expect` are for tests and invariants the
  code itself guarantees, with an `expect` message saying which.
- Errors implement `std::error::Error` and `Display`. Their message is in English, lowercase, with no final period,
  and keeps its `source()`.
- `?` carries an error up. `map_err` adds what the caller needs to know, and an error is never silently dropped.

## Readability

- Short functions, early returns, `let ... else` rather than nesting.
- A blank line between the steps of a function: after its bindings, and around a block that has statements before
  or after it.
- Descriptive names, except the conventional ones (`T`, `E`, `i` in a loop, `cx` for a context).
- No commented-out code, no `todo!()` and no empty stubs in what is committed.
- Comments say why, not what.

## Docs

- Every public item of the crates has a `///` comment, and each module a `//!` comment that says what it holds; an
  example has one where it teaches something.
- A public function's example is a doctest that compiles and runs, or is `no_run` when it needs Docker, a network
  or the user's data directory.
- `# Errors` says when a function returns an error, `# Panics` when it may panic.
- No file has a license header.

## Tests

- Unit tests sit beside the code, in `#[cfg(test)] mod tests`. What goes through the public API, or runs the
  binary, is under `tests/`.
- A test runs what it claims: real child processes, a temporary directory for the data directory, a local bare git
  repository for the store. A server is served on port 0 and called by a real client. The test awaits what it
  checks, and never uses a sleep to wait for it.
- A test double, such as a fake runner, sits behind `#[cfg(test)]` or a feature, never in the public API.
- A fixed bug gets the test that fails without its fix.
