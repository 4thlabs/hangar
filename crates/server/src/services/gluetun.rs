//! gluetun: where its tunnel exits, from its control server.

use std::sync::Arc;

use futures::future::OptionFuture;
use hangar_api::{GluetunData, GluetunPublicIp, GluetunRead};
use quoll::client;
use serde::{Deserialize, Deserializer};

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Locator, Service};

quoll::api! {
    /// The control server of gluetun, which versions its API under `/v1`.
    #[server(none)]
    api GluetunApi = "/v1";

    /// A key of the control server.
    scheme ApiKey = header "X-API-Key";

    #[auth(ApiKey)]
    group Control {
        /// `null` before gluetun has looked its address up.
        GET "/publicip/ip" => public_ip() -> Option<PublicIp>;
    }
}

/// The address the tunnel exits from, each field as text: gluetun leaves out those it has no value for.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct PublicIp {
    #[serde(deserialize_with = "PublicIp::text")]
    public_ip: String,
    #[serde(deserialize_with = "PublicIp::text")]
    city: String,
    #[serde(deserialize_with = "PublicIp::text")]
    country: String,
}

impl PublicIp {
    /// A field as text: anything but a string reads as empty, as the Waku version reads it.
    fn text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
        match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::String(text) => Ok(text),
            _ => Ok(String::new()),
        }
    }
}

/// gluetun, as the widgets read it: its clients, and its parts, each kept by its call.
#[derive(Debug)]
pub(super) struct Gluetun {
    clients: Arc<Clients<GluetunApiClient>>,
    public_ip: Part<(), GluetunPublicIp>,
}

impl Gluetun {
    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            public_ip: Part::new("gluetun public address"),
        }
    }

    /// The parts `read` asks of the gluetun `locator` finds.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        read: GluetunRead,
    ) -> Result<GluetunData, Arc<LoadError>> {
        let GluetunRead { public_ip } = read;
        let public_ip = OptionFuture::from(public_ip.then(|| self.public_ip(locator))).await;

        Ok(GluetunData {
            public_ip: public_ip.transpose()?,
        })
    }

    /// The client of the gluetun of `service`, with its key.
    fn client(service: &Service) -> Result<GluetunApiClient, LoadError> {
        service.client::<GluetunApi>("gluetun", service.key().map(client::key::<ApiKey>))
    }

    /// Where the tunnel exits. A failed call says that the control server did not answer, not that the tunnel is down:
    /// an empty address says that.
    async fn public_ip(&self, locator: &Locator) -> Result<GluetunPublicIp, Arc<LoadError>> {
        self.public_ip
            .get(locator, &self.clients, (), |client| async move {
                let public_ip = client
                    .control()
                    .public_ip()
                    .await
                    .map_err(LoadError::call("read gluetun's public address"))?
                    .unwrap_or_default();

                Ok(GluetunPublicIp {
                    public_ip: public_ip.public_ip,
                    city: public_ip.city,
                    country: public_ip.country,
                })
            })
            .await
    }
}
