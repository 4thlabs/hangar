//! The client of each placement's service, built once with its address and its credential, and built again when
//! either changes: a key changed in `.env.global`, a `url` in `hangar.yml`.

use std::any::Any;
use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use crate::services::LoadError;
use crate::services::Service;

/// The clients of the placements, by their key, each with the service it was built for.
#[derive(Default)]
pub(crate) struct Clients {
    built: Mutex<HashMap<String, Built>>,
}

/// A client, and the service it calls.
struct Built {
    service: Service,
    /// The client of the placement's contract, which `get` knows the type of.
    client: Box<dyn Any + Send + Sync>,
}

impl Clients {
    /// The client of the placement `key` for `service`: the one built for it before, unless its service changed since,
    /// or one `build` builds now, kept.
    ///
    /// # Errors
    ///
    /// The error of `build`.
    pub(crate) fn get<C>(
        &self,
        key: &str,
        service: Service,
        build: impl FnOnce(&Service) -> Result<C, LoadError>,
    ) -> Result<C, LoadError>
    where
        C: Clone + Send + Sync + 'static,
    {
        let mut built = self.lock();
        let kept = built
            .get(key)
            .filter(|kept| kept.service == service)
            .and_then(|kept| kept.client.downcast_ref::<C>());

        if let Some(client) = kept {
            return Ok(client.clone());
        }

        let client = build(&service)?;

        built.insert(
            key.to_owned(),
            Built {
                service,
                client: Box::new(client.clone()),
            },
        );

        Ok(client)
    }

    /// Forgets the clients of the placements whose key `is_kept` refuses.
    pub(crate) fn retain(&self, is_kept: impl Fn(&str) -> bool) {
        self.lock().retain(|key, _| is_kept(key));
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Built>> {
        self.built
            .lock()
            .expect("no code panics while it holds the clients")
    }
}

/// Shows how many clients there are: a client holds a credential.
impl fmt::Debug for Clients {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Clients")
            .field("count", &self.lock().len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::Clients;
    use crate::services::Service;

    fn service(key: &str) -> Service {
        Service {
            api: "http://frigate:5000".to_owned(),
            link: "https://frigate.example.com".to_owned(),
            key: Some(key.to_owned()),
        }
    }

    #[test]
    fn builds_a_placement_s_client_once_and_again_when_its_service_changes() {
        let clients = Clients::default();
        let builds = Cell::new(0);
        let build = |service: &Service| {
            builds.set(builds.get() + 1);

            Ok(service.key.clone())
        };

        assert_eq!(
            clients.get("a", service("one"), build).ok().flatten(),
            Some("one".to_owned())
        );
        assert_eq!(
            clients.get("a", service("one"), build).ok().flatten(),
            Some("one".to_owned())
        );
        assert_eq!(builds.get(), 1);

        assert_eq!(
            clients.get("a", service("two"), build).ok().flatten(),
            Some("two".to_owned())
        );
        assert_eq!(builds.get(), 2, "a new key, a new client");

        clients.retain(|key| key != "a");
        clients.get("a", service("two"), build).expect("built");
        assert_eq!(builds.get(), 3, "a placement forgotten builds anew");
    }
}
