//! The api: its prefix, its schemes, and the groups it serves, each written in the module of its area.

quoll::api! {
    /// Hangar's API, which its page calls. Every error is a problem, in English. Every route but those of `Auth` and
    /// `Health` takes a `Session`.
    pub api Api = "/api" { crate::health::Health, crate::auth::Auth };

    /// The session of the page: a cookie the server signs, `HttpOnly`, `Secure` and `SameSite=Lax`, which a subdomain
    /// cannot set.
    pub scheme Session = cookie "__Host-hangar-session";

    /// The sign-in through the provider, from its start to its callback: a cookie the server encrypts, which holds
    /// the state, the nonce and the PKCE verifier for ten minutes.
    pub scheme OidcFlow = cookie "__Host-hangar-oidc";
}
