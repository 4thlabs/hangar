//! `gluetun-vpn-status`: where gluetun's tunnel exits, from its control server.

use hangar_api::GluetunVpnStatus;
use reqwest_middleware::ClientWithMiddleware;
use serde::{Deserialize, Deserializer};

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// The control server of gluetun, which versions its API under `/v1`. Its key goes in `X-API-Key`.
    #[server(none)]
    api GluetunApi = "/v1";

    group Gluetun {
        /// `null` before gluetun has looked its address up.
        GET "/publicip/ip" => public_ip(header("X-API-Key") key: Option<&str>) -> Option<PublicIp>;
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

/// Where the tunnel of the gluetun of `service` exits. A failed call says that the control server did not answer,
/// not that the tunnel is down: an empty address says that.
pub(super) async fn load(
    http: &ClientWithMiddleware,
    service: &Service,
) -> Result<GluetunVpnStatus, LoadError> {
    let client = GluetunApi::client_with(http.clone(), &service.api)
        .map_err(LoadError::call("reach gluetun"))?;
    let public_ip = client
        .gluetun()
        .public_ip(service.key())
        .await
        .map_err(LoadError::call("read gluetun's public address"))?
        .unwrap_or_default();

    Ok(GluetunVpnStatus {
        public_ip: public_ip.public_ip,
        city: public_ip.city,
        country: public_ip.country,
    })
}
