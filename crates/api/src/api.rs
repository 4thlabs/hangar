//! The api: its prefix and the groups it serves, each written in the module of its area.

quoll::api! {
    /// Hangar's API, which its page calls. Every error is a problem, in English.
    pub api Api = "/api" { crate::health::Health };
}
