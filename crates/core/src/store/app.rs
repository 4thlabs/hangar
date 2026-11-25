//! A store app, as its `compose.yml` presents it.

use std::path::Path;

use serde_norway::Value;

use super::{Disk, Yaml, YamlError};

/// An app of the store, installed or not.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct StoreApp {
    /// Its id, the name of its folder under `store/`, and the name of its compose project.
    pub id: String,
    /// Its display name: `x-hangar.name`, else the compose file's top-level `name`, else the id capitalized.
    pub name: String,
    /// The image shown for it, `x-hangar.icon`.
    pub icon: Option<String>,
    /// Whether it is linked into `app-installed/`.
    pub installed: bool,
    /// Whether it ships a `compose.swarm.yml` with content, so that it can run in the swarm.
    pub swarm_ready: bool,
    /// The container its main service declares, which the reverse proxy routes `<container>.<DOMAIN>` to; the id
    /// when it declares none.
    pub container_name: String,
    /// Whether its main service sets `traefik.enable=true`, so that `<container>.<DOMAIN>` serves it.
    pub routed: bool,
}

impl StoreApp {
    /// The file an app is composed from.
    pub(crate) const COMPOSE_FILE: &str = "compose.yml";

    /// The file an app that can run in the swarm adds to its compose file.
    pub(crate) const SWARM_FILE: &str = "compose.swarm.yml";

    /// The label a service sets to `true` to be served at `<container>.<DOMAIN>`.
    const TRAEFIK_LABEL: &str = "traefik.enable";

    /// The app `id`, from its folder `folder`, installed or not as `installed` says.
    ///
    /// # Errors
    ///
    /// Returns the error of a `compose.yml` that cannot be read or does not load.
    pub(crate) async fn read(
        id: &str,
        folder: &Path,
        installed: bool,
    ) -> Result<Self, AppReadError> {
        let source = tokio::fs::read(folder.join(Self::COMPOSE_FILE)).await?;
        let compose = Yaml::load(&String::from_utf8_lossy(&source))?;
        let swarm_ready = Disk::has_content(&folder.join(Self::SWARM_FILE)).await;

        Ok(Self::from_compose(id, &compose, installed, swarm_ready))
    }

    /// The app `id` that `compose` presents.
    fn from_compose(id: &str, compose: &Value, installed: bool, swarm_ready: bool) -> Self {
        let metadata = compose.get("x-hangar");
        let field =
            |value: Option<&Value>, key: &str| value.and_then(|value| Self::text(value.get(key)?));
        let service = Self::main_service(id, compose);

        // `x-hangar.name` first: Swarm rejects a top-level `name`, so an app that can run there moves it.
        let name = field(metadata, "name")
            .or_else(|| field(Some(compose), "name"))
            .unwrap_or_else(|| Self::capitalize(id));

        Self {
            id: id.to_owned(),
            name,
            icon: field(metadata, "icon"),
            installed,
            swarm_ready,
            container_name: field(service, "container_name").unwrap_or_else(|| id.to_owned()),
            routed: service.is_some_and(Self::is_routed),
        }
    }

    /// The main service: the one named after the app, else the first one declared.
    fn main_service<'a>(id: &str, compose: &'a Value) -> Option<&'a Value> {
        let Some(Value::Mapping(services)) = compose.get("services") else {
            return None;
        };

        services
            .get(id)
            .filter(|service| !service.is_null())
            .or_else(|| services.values().next())
    }

    /// Whether a service opts in to Traefik, with a label in either syntax: `- traefik.enable=true` in a list, or
    /// `traefik.enable: true` in a mapping.
    fn is_routed(service: &Value) -> bool {
        match service.get("labels") {
            Some(Value::Sequence(labels)) => {
                let label = format!("{}=true", Self::TRAEFIK_LABEL);

                labels
                    .iter()
                    .any(|entry| entry.as_str() == Some(label.as_str()))
            }
            Some(Value::Mapping(labels)) => match labels.get(Self::TRAEFIK_LABEL) {
                Some(Value::Bool(value)) => *value,
                Some(Value::String(value)) => value == "true",
                _ => false,
            },
            _ => false,
        }
    }

    /// A scalar as the Waku version shows it: a string as it is, a number or a boolean as JavaScript writes it; none
    /// for `null` or a collection.
    fn text(value: &Value) -> Option<String> {
        match value {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(boolean) => Some(boolean.to_string()),
            _ => None,
        }
    }

    /// `id` with its first letter in uppercase, `beta-app` as `Beta-app`.
    fn capitalize(id: &str) -> String {
        let mut characters = id.chars();

        match characters.next() {
            Some(first) => first.to_uppercase().chain(characters).collect(),
            None => String::new(),
        }
    }
}

/// Why an app's `compose.yml` could not be read.
#[derive(Debug, thiserror::Error)]
pub(crate) enum AppReadError {
    /// The file could not be read.
    #[error("could not read its compose file")]
    Io(#[from] std::io::Error),

    /// The file does not load.
    #[error("its compose file is not valid YAML")]
    Yaml(#[from] YamlError),
}

#[cfg(test)]
mod tests {
    use super::StoreApp;
    use crate::store::Yaml;

    fn app(id: &str, compose: &str) -> StoreApp {
        let compose = Yaml::load(compose).expect("the YAML is valid");

        StoreApp::from_compose(id, &compose, false, false)
    }

    #[test]
    fn names_an_app_after_x_hangar_name_then_its_top_level_name_then_its_folder() {
        assert_eq!(
            app(
                "both-app",
                "name: Top\nx-hangar:\n  name: Both\nservices: {}\n"
            )
            .name,
            "Both"
        );
        assert_eq!(app("top-app", "name: Top\nservices: {}\n").name, "Top");
        assert_eq!(app("plain-app", "services: {}\n").name, "Plain-app");
        assert_eq!(app("game", "name: 2048\n").name, "2048");
    }

    #[test]
    fn reads_the_icon_of_x_hangar() {
        assert_eq!(
            app("alpha", "x-hangar:\n  icon: alpha.svg\n")
                .icon
                .as_deref(),
            Some("alpha.svg")
        );
        assert_eq!(app("alpha", "services: {}\n").icon, None);
    }

    #[test]
    fn takes_the_container_name_from_the_app_s_own_service_and_only_that_one() {
        let named = app(
            "frigate",
            "services:\n  frigate:\n    container_name: frigate-nvr\n",
        );
        let sidecar_first = app(
            "immich",
            "services:\n  redis:\n    container_name: immich-redis\n  immich:\n    container_name: immich-server\n",
        );
        let first = app(
            "paperless",
            "services:\n  web:\n    container_name: paperless-web\n  db: {}\n",
        );
        let unnamed = app("miniflux", "services:\n  miniflux:\n    image: miniflux\n");

        assert_eq!(named.container_name, "frigate-nvr");
        assert_eq!(sidecar_first.container_name, "immich-server");
        assert_eq!(first.container_name, "paperless-web");
        assert_eq!(unnamed.container_name, "miniflux");
    }

    #[test]
    fn knows_which_apps_traefik_serves_from_either_label_syntax_on_the_main_service() {
        assert!(
            app(
                "list-app",
                "services:\n  web:\n    labels:\n      - traefik.enable=true\n"
            )
            .routed
        );
        assert!(
            app(
                "map-app",
                "services:\n  web:\n    labels:\n      traefik.enable: true\n"
            )
            .routed
        );
        assert!(
            app(
                "quoted-app",
                "services:\n  web:\n    labels:\n      traefik.enable: 'true'\n"
            )
            .routed
        );
        assert!(!app("db-app", "services:\n  db:\n    image: postgres\n").routed);
        assert!(
            !app(
                "off-app",
                "services:\n  web:\n    labels: [traefik.enable=false]\n"
            )
            .routed
        );
    }

    #[test]
    fn presents_a_compose_file_that_is_not_a_mapping_with_the_defaults() {
        let listed = app("odd-app", "[web]\n");

        assert_eq!(listed.name, "Odd-app");
        assert_eq!(listed.container_name, "odd-app");
        assert!(!listed.routed);
    }
}
