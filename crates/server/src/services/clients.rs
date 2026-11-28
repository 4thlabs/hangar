//! The clients of a service, one per address, built with its credential, and built again when the service at that
//! address changes: a key changed in `.env.global`, a `link` in `hangar.yml`.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use super::Service;
use super::error::LoadError;

/// The clients of one service's contract, `C`, by the address the server calls, each with the service it was built
/// for.
pub(crate) struct Clients<C> {
    built: Mutex<HashMap<String, (Service, C)>>,
}

impl<C: Clone> Clients<C> {
    /// No client yet.
    pub(crate) fn new() -> Self {
        Self {
            built: Mutex::new(HashMap::new()),
        }
    }

    /// The client of `service`: the one built for it before, unless the service at its address changed since, or one
    /// `build` builds now, kept.
    ///
    /// # Errors
    ///
    /// The error of `build`.
    pub(crate) fn get(
        &self,
        service: &Service,
        build: impl FnOnce(&Service) -> Result<C, LoadError>,
    ) -> Result<C, LoadError> {
        let mut built = self.lock();

        if let Some((kept, client)) = built.get(&service.api)
            && kept == service
        {
            return Ok(client.clone());
        }

        let client = build(service)?;

        built.insert(service.api.clone(), (service.clone(), client.clone()));

        Ok(client)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (Service, C)>> {
        self.built
            .lock()
            .expect("no code panics while it holds the clients")
    }
}

/// Shows how many clients there are: a client holds a credential.
impl<C> fmt::Debug for Clients<C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self
            .built
            .lock()
            .expect("no code panics while it holds the clients")
            .len();

        f.debug_struct("Clients").field("count", &count).finish()
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::Clients;
    use crate::services::Service;

    fn service(api: &str, key: &str) -> Service {
        Service {
            api: api.to_owned(),
            link: "https://jellyfin.example.com".to_owned(),
            key: Some(key.to_owned()),
        }
    }

    #[test]
    fn builds_a_client_per_address_once_and_again_when_its_service_changes() {
        let clients = Clients::new();
        let builds = Cell::new(0);
        let build = |service: &Service| {
            builds.set(builds.get() + 1);

            Ok(service.key.clone())
        };
        let key = |service: &Service| clients.get(service, build).ok().flatten();

        assert_eq!(key(&service("http://a", "one")), Some("one".to_owned()));
        assert_eq!(key(&service("http://a", "one")), Some("one".to_owned()));
        assert_eq!(builds.get(), 1);

        assert_eq!(key(&service("http://b", "one")), Some("one".to_owned()));
        assert_eq!(builds.get(), 2, "another address, another client");

        assert_eq!(key(&service("http://a", "two")), Some("two".to_owned()));
        assert_eq!(builds.get(), 3, "a new key, a new client");
    }
}
