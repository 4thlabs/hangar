//! The bound of the bodies the routes of signing in read.

use std::convert::Infallible;
use std::future::poll_fn;

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use quoll::server;
use tower_layer::Layer;
use tower_service::Service;

/// Bounds the body of a request under `/api/auth/` to [`LIMIT`](Self::LIMIT), with quoll's `body_limit`, which
/// answers a larger one 413 before it is read: an email and a password take less than a kilobyte, where axum's
/// default would read 2 MiB for anyone, signed in or not. The other routes keep their own limit.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthBodyLimit;

impl AuthBodyLimit {
    /// The largest body a route of signing in reads.
    pub(crate) const LIMIT: usize = 16 * 1024;

    /// The paths of the group `Auth` of the contract.
    const PREFIX: &str = "/api/auth/";

    /// The middleware: the request passed on, its body bounded on the routes of signing in.
    pub(crate) async fn limit(request: Request, next: Next) -> Response {
        if !request.uri().path().starts_with(Self::PREFIX) {
            return next.run(request).await;
        }

        let mut bounded = server::body_limit(Self::LIMIT).layer(next);
        let answered: Result<Response, Infallible> = async {
            poll_fn(|cx| bounded.poll_ready(cx)).await?;
            bounded.call(request).await
        }
        .await;

        match answered {
            Ok(response) => response,
            Err(never) => match never {},
        }
    }
}
