//! The core of Hangar, on no web framework, so that the `hangar` binary and the server both run on it. For now it holds
//! its version; running commands, the store, compose and Docker come later.

mod version;

pub use version::VERSION;
