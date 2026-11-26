//! The check of the origin of a request that changes something, as Better Auth's `originCheck` does for the Waku
//! version: a page of another site cannot have a browser send it.

use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use url::{Origin, Url};

/// Refuses a request whose method is not `GET`, `HEAD` or `OPTIONS` when a browser says it comes from another origin
/// than `HANGAR_URL`'s: its `Origin` is another, or `null`, or, from a browser that sends none, its
/// `Sec-Fetch-Site` is not `same-origin`. A request that carries neither comes from no browser, as the CLI's or a
/// script's, which a page cannot make: it passes.
///
/// Every route of the API is covered, the sign-in among them, whose cookie scheme quoll's own check, against the
/// `Host`, does not cover: a page of another site would sign the browser in to an account of its choosing.
#[derive(Debug, Clone)]
pub(crate) struct OriginCheck {
    origin: Origin,
}

impl OriginCheck {
    /// The check of the origin of `url`.
    pub(crate) fn new(url: &Url) -> Self {
        Self {
            origin: url.origin(),
        }
    }

    /// The middleware: a 403 problem, or the request passed on.
    pub(crate) async fn check(State(check): State<Self>, request: Request, next: Next) -> Response {
        if check.is_cross_origin(request.method(), request.headers()) {
            return quoll::Error::new(
                StatusCode::FORBIDDEN,
                format!(
                    "the request comes from another origin than {}",
                    check.origin.ascii_serialization()
                ),
            )
            .into_response();
        }

        next.run(request).await
    }

    /// Whether a browser says the request comes from another origin.
    fn is_cross_origin(&self, method: &Method, headers: &HeaderMap) -> bool {
        if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
            return false;
        }

        if let Some(origin) = headers.get(header::ORIGIN) {
            let origin = origin
                .to_str()
                .ok()
                .and_then(|origin| Url::parse(origin).ok());

            return origin.is_none_or(|origin| origin.origin() != self.origin);
        }

        headers
            .get("sec-fetch-site")
            .is_some_and(|site| !matches!(site.as_bytes(), b"same-origin" | b"none"))
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, Method};
    use url::Url;

    use super::OriginCheck;

    fn check() -> OriginCheck {
        OriginCheck::new(&Url::parse("https://hangar.example.com/").expect("a URL"))
    }

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        pairs
            .iter()
            .map(|(name, value)| {
                (
                    name.parse().expect("a name"),
                    HeaderValue::from_static(value),
                )
            })
            .collect()
    }

    #[test]
    fn passes_a_post_from_the_url_s_origin() {
        for origin in [
            "https://hangar.example.com",
            "https://HANGAR.example.com:443",
        ] {
            assert!(
                !check().is_cross_origin(&Method::POST, &headers(&[("origin", origin)])),
                "{origin}"
            );
        }
    }

    #[test]
    fn refuses_a_post_from_another_origin() {
        for origin in [
            "https://evil.example.com",
            "http://hangar.example.com",
            "https://hangar.example.com:8443",
            "https://app.hangar.example.com",
            "null",
        ] {
            assert!(
                check().is_cross_origin(&Method::POST, &headers(&[("origin", origin)])),
                "{origin}"
            );
        }
    }

    #[test]
    fn reads_sec_fetch_site_without_an_origin() {
        assert!(check().is_cross_origin(
            &Method::DELETE,
            &headers(&[("sec-fetch-site", "cross-site")])
        ));
        assert!(
            check().is_cross_origin(&Method::PUT, &headers(&[("sec-fetch-site", "same-site")]))
        );
        assert!(
            !check().is_cross_origin(&Method::PUT, &headers(&[("sec-fetch-site", "same-origin")]))
        );
    }

    #[test]
    fn passes_what_no_browser_sent_and_every_get() {
        assert!(!check().is_cross_origin(&Method::POST, &HeaderMap::new()));
        assert!(!check().is_cross_origin(
            &Method::GET,
            &headers(&[("origin", "https://evil.example.com")])
        ));
    }
}
