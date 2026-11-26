//! The settings of signing in: the URL the page is reached at, the secret the cookies are signed with, and the OpenID
//! Connect provider, if any.

use url::Url;

use super::{Secret, SettingError};

/// How the server signs its users in.
#[derive(Debug, Clone)]
pub struct AuthSettings {
    /// The URL the page is reached at, from `HANGAR_URL`: an origin, as the page is served at the root of its host,
    /// which a `POST` must come from, and under which the provider sends the browser back.
    pub url: Url,
    /// What the cookies are signed and encrypted with, from `HANGAR_SECRET`: at least 32 bytes.
    pub secret: Secret,
    /// The OpenID Connect provider, when `HANGAR_OIDC_ISSUER` names one.
    pub oidc: Option<OidcSettings>,
}

/// The OpenID Connect provider users sign in with.
#[derive(Debug, Clone)]
pub struct OidcSettings {
    /// Its issuer, whose discovery document is at `/.well-known/openid-configuration`, from `HANGAR_OIDC_ISSUER`:
    /// written as the provider writes it, as the ID tokens must name it, a final `/` or none.
    pub issuer: String,
    /// The client the provider knows Hangar as, from `HANGAR_OIDC_CLIENT_ID`.
    pub client_id: String,
    /// The client's secret, from `HANGAR_OIDC_CLIENT_SECRET`; `None` for a public client, which PKCE alone protects.
    pub client_secret: Option<Secret>,
    /// Where the provider sends the browser back, from `HANGAR_OIDC_REDIRECT_URL`: `/api/auth/oidc/callback` of
    /// `HANGAR_URL` unless it says otherwise.
    pub redirect_url: Url,
}

impl AuthSettings {
    /// Whether the page is served over HTTPS, and its cookies are `Secure` with the prefix `__Host-`: over plain
    /// HTTP a browser keeps neither, and the page is for a trusted network only.
    pub fn is_https(&self) -> bool {
        self.url.scheme() == "https"
    }

    /// The variable of the page's URL.
    pub const URL: &str = "HANGAR_URL";
    /// The variable of the cookies' secret.
    pub const SECRET: &str = "HANGAR_SECRET";
    /// The variable of the provider's issuer.
    pub const OIDC_ISSUER: &str = "HANGAR_OIDC_ISSUER";
    /// The variable of the provider's client id.
    pub const OIDC_CLIENT_ID: &str = "HANGAR_OIDC_CLIENT_ID";
    /// The variable of the provider's client secret.
    pub const OIDC_CLIENT_SECRET: &str = "HANGAR_OIDC_CLIENT_SECRET";
    /// The variable of the provider's redirect URL.
    pub const OIDC_REDIRECT_URL: &str = "HANGAR_OIDC_REDIRECT_URL";

    /// The fewest bytes of `HANGAR_SECRET`, as Better Auth asks of `BETTER_AUTH_SECRET`: what the keys are derived from
    /// needs as many.
    pub const MIN_SECRET_LENGTH: usize = 32;

    /// The path of the callback under `HANGAR_URL`, the route of the contract.
    const CALLBACK_PATH: &str = "api/auth/oidc/callback";

    /// The settings that `variable` gives, each variable already trimmed of its empty value.
    pub(super) fn read(
        variable: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, Vec<SettingError>> {
        let url = Self::origin(variable(Self::URL));
        let secret = Self::secret(variable(Self::SECRET));
        let oidc = match &url {
            Ok(url) => Self::oidc(url, &variable),
            Err(_) => Ok(None),
        };

        match (url, secret, oidc) {
            (Ok(url), Ok(secret), Ok(oidc)) => Ok(Self { url, secret, oidc }),
            (url, secret, oidc) => Err([url.err(), secret.err()]
                .into_iter()
                .flatten()
                .chain(oidc.err().into_iter().flatten())
                .collect()),
        }
    }

    /// An `http` or `https` URL, which `HANGAR_URL` must be.
    fn url(name: &'static str, value: Option<String>) -> Result<Url, SettingError> {
        let value = value.ok_or(SettingError::NotSet { variable: name })?;
        let url = Url::parse(&value)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https") && url.has_host());

        url.ok_or(SettingError::NotAUrl {
            variable: name,
            value,
        })
    }

    /// The URL of `HANGAR_URL`, an origin with no path, query or credentials: the page calls `/api` from the root, and
    /// the redirects of signing in go to `/` and `/login`, so a page under a path would not work.
    fn origin(value: Option<String>) -> Result<Url, SettingError> {
        let url = Self::url(Self::URL, value)?;
        let is_origin = url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
            && url.username().is_empty()
            && url.password().is_none();

        if !is_origin {
            return Err(SettingError::NotAnOrigin {
                variable: Self::URL,
                value: url.to_string(),
            });
        }

        Ok(url)
    }

    /// The secret, at least 32 bytes.
    fn secret(value: Option<String>) -> Result<Secret, SettingError> {
        let value = value.ok_or(SettingError::NotSet {
            variable: Self::SECRET,
        })?;

        if value.len() < Self::MIN_SECRET_LENGTH {
            return Err(SettingError::ShortSecret);
        }

        Ok(Secret(value))
    }

    /// The provider, whose issuer and client id are set together.
    fn oidc(
        url: &Url,
        variable: &impl Fn(&str) -> Option<String>,
    ) -> Result<Option<OidcSettings>, Vec<SettingError>> {
        let issuer = variable(Self::OIDC_ISSUER);
        let client_id = variable(Self::OIDC_CLIENT_ID);
        let redirect_url = variable(Self::OIDC_REDIRECT_URL);

        let (issuer, client_id) = match (issuer, client_id) {
            (None, None) => return Ok(None),
            (Some(_), None) => {
                return Err(vec![SettingError::NeededBy {
                    variable: Self::OIDC_CLIENT_ID,
                    by: Self::OIDC_ISSUER,
                }]);
            }
            (None, Some(_)) => {
                return Err(vec![SettingError::NeededBy {
                    variable: Self::OIDC_ISSUER,
                    by: Self::OIDC_CLIENT_ID,
                }]);
            }
            (Some(issuer), Some(client_id)) => (issuer, client_id),
        };
        let issuer = Self::url(Self::OIDC_ISSUER, Some(issuer.clone())).map(|_| issuer);
        let redirect_url = match redirect_url {
            Some(value) => Self::url(Self::OIDC_REDIRECT_URL, Some(value)),
            None => Ok(Self::callback(url)),
        };

        match (issuer, redirect_url) {
            (Ok(issuer), Ok(redirect_url)) => Ok(Some(OidcSettings {
                issuer,
                client_id,
                client_secret: variable(Self::OIDC_CLIENT_SECRET).map(Secret),
                redirect_url,
            })),
            (issuer, redirect_url) => Err([issuer.err(), redirect_url.err()]
                .into_iter()
                .flatten()
                .collect()),
        }
    }

    /// The callback at the origin `url`.
    fn callback(url: &Url) -> Url {
        url.join(Self::CALLBACK_PATH)
            .expect("a relative path joins any http URL")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{AuthSettings, SettingError};

    /// The settings of `variables`, and nothing else.
    fn read(variables: &[(&str, &str)]) -> Result<AuthSettings, Vec<SettingError>> {
        let variables: HashMap<&str, &str> = variables.iter().copied().collect();

        AuthSettings::read(|name| variables.get(name).map(|value| (*value).to_owned()))
    }

    const SECRET: (&str, &str) = ("HANGAR_SECRET", "0123456789abcdef0123456789abcdef");

    #[test]
    fn reads_the_url_and_the_secret_and_no_provider() {
        let settings =
            read(&[("HANGAR_URL", "https://hangar.example.com"), SECRET]).expect("valid");

        assert_eq!(settings.url.as_str(), "https://hangar.example.com/");
        assert!(settings.is_https());
        assert_eq!(settings.secret.expose(), SECRET.1);
        assert!(settings.oidc.is_none());
    }

    #[test]
    fn needs_the_url_and_a_secret_of_32_bytes() {
        let errors = read(&[("HANGAR_SECRET", "too short")]).expect_err("refused");

        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            [
                "HANGAR_URL is not set",
                "HANGAR_SECRET must be at least 32 bytes: `openssl rand -base64 32` prints one"
            ]
        );
    }

    #[test]
    fn refuses_a_url_that_is_not_http() {
        for url in [
            "hangar.example.com",
            "ftp://hangar.example.com",
            "https://",
            "/login",
        ] {
            let errors = read(&[("HANGAR_URL", url), SECRET]).expect_err("refused");

            assert!(
                matches!(
                    &errors[..],
                    [SettingError::NotAUrl {
                        variable: "HANGAR_URL",
                        ..
                    }]
                ),
                "{url}: {errors:?}"
            );
        }
    }

    #[test]
    fn refuses_a_url_that_is_not_an_origin() {
        for url in [
            "https://example.com/hangar",
            "https://hangar.example.com/?page=1",
            "https://hangar.example.com/#top",
            "https://ana:secret@hangar.example.com",
        ] {
            let errors = read(&[("HANGAR_URL", url), SECRET]).expect_err("refused");

            assert!(
                matches!(
                    &errors[..],
                    [SettingError::NotAnOrigin {
                        variable: "HANGAR_URL",
                        ..
                    }]
                ),
                "{url}: {errors:?}"
            );
        }

        assert!(
            read(&[("HANGAR_URL", "http://localhost:5173/"), SECRET]).is_ok(),
            "a final / is no path"
        );
    }

    #[test]
    fn reads_the_provider_with_its_callback_under_the_url() {
        let settings = read(&[
            ("HANGAR_URL", "https://hangar.example.com"),
            SECRET,
            (
                "HANGAR_OIDC_ISSUER",
                "https://auth.example.com/application/o/hangar/",
            ),
            ("HANGAR_OIDC_CLIENT_ID", "hangar"),
            ("HANGAR_OIDC_CLIENT_SECRET", "s3cret"),
        ])
        .expect("valid");
        let oidc = settings.oidc.expect("a provider");

        assert_eq!(
            oidc.issuer,
            "https://auth.example.com/application/o/hangar/"
        );
        assert_eq!(oidc.client_id, "hangar");
        assert_eq!(
            oidc.client_secret.as_ref().map(super::Secret::expose),
            Some("s3cret")
        );
        assert_eq!(
            oidc.redirect_url.as_str(),
            "https://hangar.example.com/api/auth/oidc/callback"
        );
    }

    #[test]
    fn takes_the_redirect_url_it_is_given() {
        let settings = read(&[
            ("HANGAR_URL", "http://localhost:5173"),
            SECRET,
            ("HANGAR_OIDC_ISSUER", "https://auth.example.com"),
            ("HANGAR_OIDC_CLIENT_ID", "hangar"),
            (
                "HANGAR_OIDC_REDIRECT_URL",
                "http://localhost:3011/api/auth/oidc/callback",
            ),
        ])
        .expect("valid");
        let oidc = settings.oidc.expect("a provider");

        assert_eq!(
            oidc.redirect_url.as_str(),
            "http://localhost:3011/api/auth/oidc/callback"
        );
        assert!(oidc.client_secret.is_none());
    }

    #[test]
    fn needs_the_issuer_and_the_client_id_together() {
        let without_id = read(&[
            ("HANGAR_URL", "https://hangar.example.com"),
            SECRET,
            ("HANGAR_OIDC_ISSUER", "https://auth.example.com"),
        ])
        .expect_err("refused");
        let without_issuer = read(&[
            ("HANGAR_URL", "https://hangar.example.com"),
            SECRET,
            ("HANGAR_OIDC_CLIENT_ID", "hangar"),
        ])
        .expect_err("refused");

        assert_eq!(
            without_id[0].to_string(),
            "HANGAR_OIDC_CLIENT_ID is not set, which HANGAR_OIDC_ISSUER needs"
        );
        assert_eq!(
            without_issuer[0].to_string(),
            "HANGAR_OIDC_ISSUER is not set, which HANGAR_OIDC_CLIENT_ID needs"
        );
    }
}
