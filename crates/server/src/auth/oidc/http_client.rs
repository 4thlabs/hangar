//! The HTTP client of `openidconnect`, on reqwest 0.13: the crate's own is on reqwest 0.12, behind its default
//! features, which are off.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use openidconnect::{AsyncHttpClient, HttpClientError, HttpRequest, HttpResponse};
use reqwest::redirect::Policy;

/// What the sign-in calls the provider with: its discovery document, its keys and its token endpoint.
///
/// It follows no redirect, as `openidconnect` asks of its clients: a token request redirected elsewhere would carry
/// the code and the client's secret there. A call is cut after [`TIMEOUT`](Self::TIMEOUT), so that a provider that
/// does not answer does not hold the browser's request.
#[derive(Debug, Clone)]
pub(crate) struct HttpClient {
    client: reqwest::Client,
}

impl HttpClient {
    /// How long a call to the provider may take.
    const TIMEOUT: Duration = Duration::from_secs(10);

    /// A client with no redirects and the timeout.
    ///
    /// # Panics
    ///
    /// When reqwest cannot set up TLS, which its rustls feature with the platform's roots always can.
    pub(crate) fn new() -> Self {
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .timeout(Self::TIMEOUT)
            .build()
            .expect("reqwest builds a client with rustls");

        Self { client }
    }
}

impl<'c> AsyncHttpClient<'c> for HttpClient {
    type Error = HttpClientError<reqwest::Error>;
    type Future =
        Pin<Box<dyn Future<Output = Result<HttpResponse, Self::Error>> + Send + Sync + 'c>>;

    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(async move {
            let request = reqwest::Request::try_from(request).map_err(Box::new)?;
            let response = self.client.execute(request).await.map_err(Box::new)?;
            let mut builder = http::Response::builder()
                .status(response.status())
                .version(response.version());

            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }

            let body = response.bytes().await.map_err(Box::new)?;

            builder.body(body.to_vec()).map_err(HttpClientError::Http)
        })
    }
}
