//! `hangar`: Hangar from a shell, on `hangar-core`. For now it prints its version; the commands come later.

use clap::Parser;

/// Hangar from a shell. For now it prints its version.
#[derive(Parser)]
#[command(name = "hangar", version = hangar_core::VERSION)]
struct Cli {}

fn main() {
    Cli::parse();
}
