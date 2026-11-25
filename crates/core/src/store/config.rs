//! `hangar.yml`, the configuration a store ships: its categories, its shared files, the dashboard, the pause between
//! two registry calls and the backups, checked by the rules of the Waku version's zod schema, so that a file one
//! version takes, the other takes too.

mod backup;
mod cron;
mod rules;
mod widget;

use std::time::Duration;

use serde::Deserialize;
use serde_norway::Value;

pub use backup::Backup;
pub use widget::{Column, FollowedCard, ServiceOptions, Widget, WidgetKind};

use super::{Yaml, YamlError};
use backup::BackupFields;
use rules::{
    AppIdPattern, EntryName, Integer, List, MAX_SAFE_INTEGER, Matching, NonEmpty, present,
};

/// A `hangar.yml` that does not parse.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The file is not YAML, holds no document, or several.
    #[error("invalid YAML")]
    Syntax(#[source] YamlError),

    /// The YAML does not follow the rules of `hangar.yml`.
    #[error("{field}: {message}")]
    Invalid {
        /// The path of the field at fault, as `categories[0].color`; `.` for the whole file.
        field: String,
        /// What is wrong with it.
        message: String,
    },
}

/// The configuration of a store, from its `hangar.yml`.
///
/// ```
/// use hangar_core::Config;
///
/// let config = Config::parse("categories:\n  - { name: Media, color: '#a855f7', stacks: [jellyfin] }\n")?;
///
/// assert_eq!(config.stacks(), ["jellyfin"]);
/// assert_eq!(config.widgets.len(), 3, "the default dashboard");
/// # Ok::<(), hangar_core::ConfigError>(())
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Config {
    /// The groups the apps are filtered by, and the order commands run in.
    pub categories: Vec<Category>,
    /// The files under `store/` that are not apps but that stacks reference, linked beside them at install: each a
    /// single name, which never leaves `store/` nor `app-installed/`.
    pub shared: Vec<String>,
    /// The dashboard, in declaration order: a clock and Docker's stats in the first column and Frigate's events in the
    /// third unless the file declares its own.
    pub widgets: Vec<Widget>,
    /// The pause between two registry calls in the image update check, 100 ms by default: registries rate-limit a
    /// burst.
    pub registry_throttling: Duration,
    /// The apps whose data folder is backed up, each once.
    pub backups: Vec<Backup>,
}

/// A group of apps.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Category {
    /// Its name, shown in the filters and usable as a target of the CLI.
    pub name: String,
    /// Any CSS color.
    pub color: String,
    /// Its app ids, in start order: each a folder name under `store/`.
    pub stacks: Vec<String>,
}

/// `hangar.yml` as it is declared.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", expecting = "a mapping")]
struct ConfigFields {
    categories: List<CategoryFields>,
    #[serde(default)]
    shared: List<EntryName>,
    /// Read one by one: the type of a widget says which fields it has.
    #[serde(default, deserialize_with = "present")]
    widgets: Option<List<Value>>,
    #[serde(default = "ConfigFields::default_registry_throttling")]
    registry_throttling: Integer<0, MAX_SAFE_INTEGER>,
    #[serde(default)]
    backups: List<BackupFields>,
}

impl ConfigFields {
    /// The pause between two registry calls when the file does not say, in milliseconds.
    fn default_registry_throttling() -> Integer<0, MAX_SAFE_INTEGER> {
        Integer(100)
    }
}

/// A category as it is declared.
#[derive(Deserialize)]
struct CategoryFields {
    name: NonEmpty,
    color: NonEmpty,
    stacks: List<Matching<AppIdPattern>>,
}

impl Config {
    /// Parses and checks `hangar.yml`.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Syntax`] when `source` is not a single YAML document, and [`ConfigError::Invalid`],
    /// naming the first field at fault, when it does not follow the rules of `hangar.yml`.
    pub fn parse(source: &str) -> Result<Self, ConfigError> {
        let document = Yaml::load(source).map_err(ConfigError::Syntax)?;
        let fields: ConfigFields = serde_path_to_error::deserialize(document)
            .map_err(|error| ConfigError::deserializing("", &error))?;
        let widgets = match fields.widgets {
            Some(declarations) => declarations
                .0
                .iter()
                .enumerate()
                .map(|(index, declaration)| Widget::parse(index, declaration))
                .collect::<Result<_, _>>()?,
            None => Widget::defaults(),
        };
        let backups: Vec<Backup> = fields.backups.0.into_iter().map(Backup::from).collect();

        Backup::check_unique(&backups)?;

        Ok(Self {
            categories: fields
                .categories
                .0
                .into_iter()
                .map(Category::from)
                .collect(),
            shared: fields.shared.0.into_iter().map(|file| file.0).collect(),
            widgets,
            registry_throttling: Duration::from_millis(fields.registry_throttling.unsigned()),
            backups,
        })
    }

    /// Every app the categories list, in category order, each once.
    pub fn stacks(&self) -> Vec<&str> {
        let mut stacks: Vec<&str> = Vec::new();

        for stack in self.categories.iter().flat_map(|category| &category.stacks) {
            if !stacks.contains(&stack.as_str()) {
                stacks.push(stack);
            }
        }

        stacks
    }

    /// The backup of `app`, `None` when `hangar.yml` declares none.
    pub fn backup(&self, app: &str) -> Option<&Backup> {
        self.backups.iter().find(|backup| backup.app == app)
    }
}

impl Default for Config {
    /// The configuration of a store without a `hangar.yml`: no category, and every default.
    fn default() -> Self {
        Self {
            categories: Vec::new(),
            shared: Vec::new(),
            widgets: Widget::defaults(),
            registry_throttling: Duration::from_millis(100),
            backups: Vec::new(),
        }
    }
}

impl From<CategoryFields> for Category {
    fn from(fields: CategoryFields) -> Self {
        Self {
            name: fields.name.0,
            color: fields.color.0,
            stacks: fields.stacks.0.into_iter().map(|stack| stack.0).collect(),
        }
    }
}

impl ConfigError {
    /// An error on the field at `field`.
    fn invalid(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Invalid {
            field: field.into(),
            message: message.into(),
        }
    }

    /// The error of a field under `prefix`, the path of the value deserialized, empty for the whole file. A missing
    /// field is named in the path, as zod does, rather than its parent alone.
    fn deserializing(
        prefix: &str,
        error: &serde_path_to_error::Error<serde_norway::Error>,
    ) -> Self {
        let message = error.inner().to_string();
        let path = Self::join(prefix, &error.path().to_string());
        let missing = message
            .strip_prefix("missing field `")
            .and_then(|rest| rest.strip_suffix('`'));
        let field = match missing {
            Some(missing) => Self::join(&path, missing),
            None => path,
        };

        Self::invalid(field, message)
    }

    /// `path` under `prefix`, as serde_path_to_error writes a path: `.` alone for the root, `[0]` for an item.
    fn join(prefix: &str, path: &str) -> String {
        let is_root = |path: &str| path.is_empty() || path == ".";

        match (is_root(prefix), is_root(path)) {
            (true, true) => ".".to_owned(),
            (true, false) => path.to_owned(),
            (false, true) => prefix.to_owned(),
            (false, false) if path.starts_with('[') => format!("{prefix}{path}"),
            (false, false) => format!("{prefix}.{path}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{Backup, Category, Config, ConfigError, WidgetKind};

    /// The field and the message of a configuration that does not follow the rules.
    fn invalid(source: &str) -> (String, String) {
        match Config::parse(source) {
            Err(ConfigError::Invalid { field, message }) => (field, message),
            other => panic!("expected an invalid configuration, got {other:?}"),
        }
    }

    #[test]
    fn reads_the_categories_and_every_default() {
        let config = Config::parse(
            "categories:\n  - name: infra\n    color: blue\n    stacks: [traefik, backrest]\n",
        )
        .expect("the configuration is valid");

        assert_eq!(
            config.categories,
            [Category {
                name: "infra".to_owned(),
                color: "blue".to_owned(),
                stacks: vec!["traefik".to_owned(), "backrest".to_owned()],
            }]
        );
        assert!(config.shared.is_empty());
        assert_eq!(config.registry_throttling, Duration::from_millis(100));
        assert!(config.backups.is_empty());

        let widget_kinds: Vec<_> = config.widgets.iter().map(|widget| &widget.kind).collect();

        assert!(matches!(
            widget_kinds[..],
            [
                WidgetKind::Clock,
                WidgetKind::DockerGeneralStats,
                WidgetKind::FrigateEvents { .. }
            ]
        ));
    }

    #[test]
    fn reads_the_shared_files_and_the_registry_throttling() {
        let config =
            Config::parse("categories: []\nshared: [networks.yml]\nregistryThrottling: 50\n")
                .expect("the configuration is valid");

        assert_eq!(config.shared, ["networks.yml"]);
        assert_eq!(config.registry_throttling, Duration::from_millis(50));
    }

    #[test]
    fn lists_every_stack_once_in_category_order() {
        let config = Config::parse(
            "categories:\n  - { name: a, color: blue, stacks: [alpha, beta] }\n  - { name: b, color: red, stacks: [beta, gamma] }\n",
        )
        .expect("the configuration is valid");

        assert_eq!(config.stacks(), ["alpha", "beta", "gamma"]);
    }

    #[test]
    fn keeps_an_empty_dashboard_the_file_declares() {
        let config =
            Config::parse("categories: []\nwidgets: []\n").expect("the configuration is valid");

        assert!(config.widgets.is_empty());
    }

    #[test]
    fn ignores_the_fields_it_does_not_know_as_zod_does() {
        let config = Config::parse("categories: []\nstore: https://example.com/store.git\n")
            .expect("an unknown field is left out");

        assert!(config.categories.is_empty());
    }

    #[test]
    fn names_the_field_at_fault() {
        assert_eq!(
            invalid("categories:\n  - name: infra\n    stacks: [traefik]\n"),
            (
                "categories[0].color".to_owned(),
                "missing field `color`".to_owned()
            )
        );
        assert_eq!(
            invalid("store: https://example.com/store.git\n").0,
            "categories"
        );
        assert_eq!(
            invalid("categories: []\nwidgets:\n  - type: relases\n    column: 3\n").0,
            "widgets[0].type"
        );
        assert_eq!(
            invalid("categories:\n  - { name: '', color: blue, stacks: [] }\n").0,
            "categories[0].name"
        );
        assert_eq!(invalid("categories: []\nshared: [1]\n").0, "shared[0]");
        assert_eq!(invalid("- categories\n").0, ".");
    }

    #[test]
    fn refuses_a_stack_that_is_not_an_app_id() {
        for stack in [
            "../../app-data",
            "a/b",
            "/etc",
            "..",
            ".hidden",
            "Jellyfin",
            "",
        ] {
            let source =
                format!("categories:\n  - {{ name: a, color: blue, stacks: ['{stack}'] }}\n");

            assert_eq!(
                invalid(&source),
                (
                    "categories[0].stacks[0]".to_owned(),
                    "invalid app id".to_owned()
                ),
                "{stack:?}"
            );
        }
    }

    #[test]
    fn refuses_a_shared_file_that_leaves_the_store() {
        for file in [
            "../networks.yml",
            "common/networks.yml",
            "/etc/passwd",
            ".",
            "..",
            "networks.yml/",
            "",
        ] {
            let source = format!("categories: []\nshared: [networks.yml, '{file}']\n");
            let (field, message) = invalid(&source);

            assert_eq!(field, "shared[1]", "{file:?}");
            assert!(
                message.starts_with("must be a file name under store/"),
                "{file:?}: {message}"
            );
        }
    }

    #[test]
    fn rejects_null_where_zod_does() {
        assert_eq!(invalid("categories:\n").0, "categories");
        assert_eq!(invalid("categories: []\nshared:\n").0, "shared");
        assert_eq!(invalid("categories: []\nwidgets: ~\n").0, "widgets");
        assert_eq!(
            invalid("categories: []\nbackups:\n  - { app: jellyfin, schedule: }\n").0,
            "backups[0].schedule"
        );
    }

    #[test]
    fn tells_invalid_yaml_from_an_invalid_configuration() {
        for source in ["categories: [", "", "a: 1\n---\nb: 2\n"] {
            assert!(
                matches!(Config::parse(source), Err(ConfigError::Syntax(_))),
                "{source:?}"
            );
        }
    }

    #[test]
    fn reads_the_backups_with_their_defaults_and_finds_one_by_app() {
        let config = Config::parse(
            "categories: []\nbackups:\n  - app: jellyfin\n    schedule: \"30 3 * * *\"\n    exclude: [\"**/cache/**\"]\n  - app: miniflux\n    path: miniflux/db\n    keep: 2\n    stop: true\n",
        )
        .expect("the configuration is valid");

        assert_eq!(
            config.backups,
            [
                Backup {
                    app: "jellyfin".to_owned(),
                    schedule: Some("30 3 * * *".to_owned()),
                    keep: 7,
                    stop: false,
                    path: None,
                    include: vec!["**".to_owned()],
                    exclude: vec!["**/cache/**".to_owned()],
                },
                Backup {
                    app: "miniflux".to_owned(),
                    schedule: None,
                    keep: 2,
                    stop: true,
                    path: Some("miniflux/db".to_owned()),
                    include: vec!["**".to_owned()],
                    exclude: Vec::new(),
                },
            ]
        );
        assert_eq!(config.backup("miniflux").map(|backup| backup.keep), Some(2));
        assert_eq!(config.backup("immich"), None);
    }

    #[test]
    fn rejects_a_backup_scheduled_with_an_invalid_cron_expression() {
        assert_eq!(
            invalid("categories: []\nbackups:\n  - { app: jellyfin, schedule: \"61 * * * *\" }\n"),
            (
                "backups[0].schedule".to_owned(),
                "invalid cron expression".to_owned()
            )
        );
    }

    #[test]
    fn rejects_a_backup_path_that_leaves_the_app_data() {
        for folder in ["../hangar", "/etc", "jellyfin/../hangar", ".", "jellyfin/"] {
            let source =
                format!("categories: []\nbackups:\n  - {{ app: jellyfin, path: \"{folder}\" }}\n");

            assert_eq!(invalid(&source).0, "backups[0].path", "{folder}");
        }
    }

    #[test]
    fn rejects_an_app_backed_up_twice_and_an_id_that_is_not_an_app_s() {
        assert_eq!(
            invalid("categories: []\nbackups:\n  - { app: jellyfin }\n  - { app: jellyfin }\n"),
            (
                "backups[1].app".to_owned(),
                "jellyfin is backed up twice".to_owned()
            )
        );
        assert_eq!(
            invalid("categories: []\nbackups:\n  - { app: \"../jellyfin\" }\n").0,
            "backups[0].app"
        );
    }

    #[test]
    fn rejects_the_backup_fields_out_of_their_bounds() {
        let entries = [
            "{ app: a, keep: 0 }",
            "{ app: a, include: [] }",
            "{ app: a, stop: yes }",
            "{ app: a, exclude: [''] }",
        ];

        for entry in entries {
            let source = format!("categories: []\nbackups:\n  - {entry}\n");

            assert!(Config::parse(&source).is_err(), "{entry}");
        }
    }
}
