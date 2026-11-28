//! `gluetun-vpn-status`: where gluetun's tunnel exits, from its control server.

use hangar_api::GluetunVpnStatus;
use quoll::client;
use serde::{Deserialize, Deserializer};

use crate::services::LoadError;
use crate::services::Service;

quoll::api! {
    /// The control server of gluetun, which versions its API under `/v1`.
    #[server(none)]
    api GluetunApi = "/v1";

    /// A key of the control server.
    scheme ApiKey = header "X-API-Key";

    #[auth(ApiKey)]
    group Gluetun {
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

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(GluetunApiClient);

impl Client {
    /// The client of the service `service`, with its key.
    ///
    /// # Errors
    ///
    /// When the client cannot be built, or the key cannot be sent.
    pub(super) fn new(service: &Service) -> Result<Self, LoadError> {
        build(service).map(Self)
    }
}

/// The client of the gluetun of `service`, with its key.
fn build(service: &Service) -> Result<GluetunApiClient, LoadError> {
    service.client::<GluetunApi>("gluetun", service.key().map(client::key::<ApiKey>))
}

/// Where the tunnel of the gluetun of `client` exits. A failed call says that the control server did not answer,
/// not that the tunnel is down: an empty address says that.
pub(super) async fn load(client: &Client) -> Result<GluetunVpnStatus, LoadError> {
    let public_ip = client
        .0
        .gluetun()
        .public_ip()
        .await
        .map_err(LoadError::call("read gluetun's public address"))?
        .unwrap_or_default();

    Ok(GluetunVpnStatus {
        public_ip: public_ip.public_ip,
        city: public_ip.city,
        country: public_ip.country,
    })
}
