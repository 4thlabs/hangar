//! The api: its prefix, and the groups it serves, each written in the module of its area. Its schemes, the cookies of
//! the page, are the contract's own types, in `auth`: each has a name over HTTPS and another over plain HTTP.

quoll::api! {
    /// Hangar's API, which its page calls. Every error is a problem, in English. Every route but those of `Auth` and
    /// `Health` takes a `Session`.
    pub api Api = "/api" { crate::health::Health, crate::auth::Auth };

}
