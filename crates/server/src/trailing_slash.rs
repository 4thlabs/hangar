//! The redirect of a path with a final `/` to the one without, as the Waku version's `trimTrailingSlash`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header::LOCATION;
use axum::http::{Method, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use percent_encoding::percent_decode_str;

/// Redirects a `GET` or a `HEAD` of a path that ends with a `/`, but `/`, to that path without it, query kept, with a
/// 301, as hono's `trimTrailingSlash({ alwaysRedirect: true })` does for the Waku version.
///
/// A path that names a directory of the page is left alone: quoll serves a directory at its path with a final `/`,
/// and redirects there, which would loop with this redirect.
#[derive(Debug, Clone)]
pub(crate) struct TrailingSlash {
    /// The page's directory, if the server serves one.
    page: Option<Arc<Path>>,
}

impl TrailingSlash {
    /// The redirect, beside the page of `page`.
    pub(crate) fn new(page: Option<PathBuf>) -> Self {
        Self {
            page: page.map(Arc::from),
        }
    }

    /// The middleware: the redirect, or the request passed on.
    pub(crate) async fn redirect(
        State(trailing_slash): State<Self>,
        request: Request,
        next: Next,
    ) -> Response {
        let redirected = matches!(*request.method(), Method::GET | Method::HEAD);
        // The URI alone across the `.await`: the request's body is not `Sync`, and the future must be `Send`.
        let uri = request.uri().clone();
        let location = if redirected {
            trailing_slash.location(&uri).await
        } else {
            None
        };

        match location {
            Some(location) => {
                (StatusCode::MOVED_PERMANENTLY, [(LOCATION, location)]).into_response()
            }
            None => next.run(request).await,
        }
    }

    /// Where a `GET` of `uri` is redirected to, if it is.
    async fn location(&self, uri: &Uri) -> Option<String> {
        let path = uri.path().strip_suffix('/')?;

        // `//host` and `/\host` name another host to a browser: those are no path to send it to.
        let another_host = path.starts_with("//") || path.starts_with("/\\");

        if path.is_empty() || another_host || self.is_page_directory(path).await {
            return None;
        }

        let query = uri
            .query()
            .map(|query| format!("?{query}"))
            .unwrap_or_default();

        Some(format!("{path}{query}"))
    }

    /// Whether `path`, decoded, names a directory of the page.
    async fn is_page_directory(&self, path: &str) -> bool {
        let Some(page) = &self.page else {
            return false;
        };
        let Ok(decoded) = percent_decode_str(path).decode_utf8() else {
            return false;
        };

        // Out of the page's directory: quoll serves nothing there, so the redirect does no harm.
        if decoded.split('/').any(|segment| segment == "..") {
            return false;
        }

        tokio::fs::metadata(page.join(decoded.trim_start_matches('/')))
            .await
            .is_ok_and(|metadata| metadata.is_dir())
    }
}
