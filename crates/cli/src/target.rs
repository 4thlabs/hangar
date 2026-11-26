//! What a compose command runs on: every app `hangar.yml` lists, a category, or one app.

use hangar_core::Config;

/// What a compose command runs on, as the Node CLI resolves it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Target {
    /// Every app the categories list.
    EveryApp,
    /// A category's apps, or an app by its id when no category has this name.
    Named(String),
}

impl Target {
    /// The apps the target covers in `config`. A name that is no category is taken for an app, and a category with no
    /// app as well, as the Node CLI takes them; the batch then says whether it is installed.
    pub(crate) fn apps(&self, config: &Config) -> Vec<String> {
        let Self::Named(name) = self else {
            return config.stacks().into_iter().map(str::to_owned).collect();
        };
        let apps: Vec<String> = config
            .categories
            .iter()
            .filter(|category| category.name == *name)
            .flat_map(|category| category.stacks.iter().cloned())
            .collect();

        if apps.is_empty() {
            return vec![name.clone()];
        }

        apps
    }
}

#[cfg(test)]
mod tests {
    use hangar_core::Config;

    use super::Target;

    fn config() -> Config {
        Config::parse(
            "
categories:
  - { name: Network, color: blue, stacks: [traefik, gluetun] }
  - { name: Media, color: purple, stacks: [jellyfin, traefik] }
  - { name: Empty, color: grey, stacks: [] }
",
        )
        .expect("the categories parse")
    }

    #[test]
    fn covers_every_listed_app_once() {
        assert_eq!(
            Target::EveryApp.apps(&config()),
            ["traefik", "gluetun", "jellyfin"]
        );
    }

    #[test]
    fn covers_the_apps_of_a_category() {
        assert_eq!(
            Target::Named("Media".into()).apps(&config()),
            ["jellyfin", "traefik"]
        );
    }

    #[test]
    fn takes_any_other_name_for_an_app() {
        assert_eq!(
            Target::Named("miniflux".into()).apps(&config()),
            ["miniflux"]
        );
        assert_eq!(Target::Named("Empty".into()).apps(&config()), ["Empty"]);
    }
}
