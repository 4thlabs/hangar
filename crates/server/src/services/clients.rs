//! The clients of a service, one per service as its declarations write it, built with its address and its credential,
//! and built again when either changes: a key changed in `.env.global`, the address of a container renamed.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use super::error::LoadError;
use super::{Locator, Service, ServiceKey};

/// The clients of one service's contract, `C`, by where the declarations say the service is, each with the address and
/// the key it was built for.
pub(crate) struct Clients<C> {
    build: fn(&Service) -> Result<C, LoadError>,
    built: Mutex<HashMap<ServiceKey, Built<C>>>,
}

/// A client, and what it calls with.
struct Built<C> {
    api: String,
    key: Option<String>,
    client: C,
}

impl<C: Clone> Clients<C> {
    /// No client yet; `build` builds each.
    pub(crate) fn new(build: fn(&Service) -> Result<C, LoadError>) -> Arc<Self> {
        Arc::new(Self {
            build,
            built: Mutex::new(HashMap::new()),
        })
    }

    /// The client of the service `locator` finds, resolved now: the one built for it before, unless its address or its
    /// key changed since, or one built now, kept. The clients of services no declaration names any more are dropped
    /// then, as a client of the same service's contract is taken: until then, or until the server stops, they stay.
    ///
    /// # Errors
    ///
    /// When the service cannot be resolved, or its client built.
    pub(crate) async fn of(&self, locator: &Locator) -> Result<C, LoadError> {
        let service = locator.service().await?;
        let key = locator.key();

        self.get(key, &service, |kept| locator.is_declared(kept))
    }

    /// The client of `service`, declared as `key`, among those whose key `is_declared` keeps.
    fn get(
        &self,
        key: ServiceKey,
        service: &Service,
        is_declared: impl Fn(&ServiceKey) -> bool,
    ) -> Result<C, LoadError> {
        let mut built = self.lock();

        built.retain(|kept, _| is_declared(kept));

        if let Some(kept) = built.get(&key)
            && kept.api == service.api
            && kept.key == service.key
        {
            return Ok(kept.client.clone());
        }

        let client = (self.build)(service)?;

        built.insert(
            key,
            Built {
                api: service.api.clone(),
                key: service.key.clone(),
                client: client.clone(),
            },
        );

        Ok(client)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ServiceKey, Built<C>>> {
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::Clients;
    use crate::services::{Service, ServiceKey};

    static BUILDS: AtomicUsize = AtomicUsize::new(0);

    fn build(service: &Service) -> Result<Option<String>, crate::services::LoadError> {
        BUILDS.fetch_add(1, Ordering::SeqCst);

        Ok(service.key.clone())
    }

    fn service(api: &str, key: &str) -> Service {
        Service {
            api: api.to_owned(),
            key: Some(key.to_owned()),
        }
    }

    fn key(address: &str) -> ServiceKey {
        ServiceKey {
            app: "jellyfin",
            address: Some(address.to_owned()),
        }
    }

    #[test]
    fn builds_a_client_once_and_again_when_its_address_or_key_changes_and_forgets_one_no_longer_declared()
     {
        let clients = Clients::new(build);
        let declared = |kept: &ServiceKey| *kept == key("a");
        let get = |service: &Service| clients.get(key("a"), service, declared).ok().flatten();

        assert_eq!(get(&service("http://a", "one")), Some("one".to_owned()));
        assert_eq!(get(&service("http://a", "one")), Some("one".to_owned()));
        assert_eq!(BUILDS.load(Ordering::SeqCst), 1);

        assert_eq!(get(&service("http://a", "two")), Some("two".to_owned()));
        assert_eq!(BUILDS.load(Ordering::SeqCst), 2, "a new key, a new client");

        get(&service("http://b", "two"));
        assert_eq!(
            BUILDS.load(Ordering::SeqCst),
            3,
            "a new address, a new client"
        );

        clients
            .get(key("b"), &service("http://b", "two"), |kept| {
                *kept == key("b")
            })
            .expect("built");
        assert_eq!(
            clients.lock().keys().collect::<Vec<_>>(),
            [&key("b")],
            "a dropped"
        );
    }

    #[tokio::test]
    async fn reuses_the_client_of_a_declared_service_across_two_reads() {
        static OF_A_READ: AtomicUsize = AtomicUsize::new(0);

        fn counted(service: &Service) -> Result<Option<String>, crate::services::LoadError> {
            OF_A_READ.fetch_add(1, Ordering::SeqCst);

            Ok(service.key.clone())
        }

        let clients = Clients::new(counted);
        let read = || crate::services::tests::fixed_locator("https://api.github.com");

        assert_eq!(
            clients.of(&read()).await.ok().flatten(),
            Some("token".to_owned())
        );
        assert_eq!(
            clients.of(&read()).await.ok().flatten(),
            Some("token".to_owned())
        );
        assert_eq!(
            OF_A_READ.load(Ordering::SeqCst),
            1,
            "built once, for the first read"
        );
    }
}
