//! The store on a temporary data directory, cloned and pulled by real git from a local bare repository.

#![cfg(unix)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use hangar_core::{DataDir, Output, Runtime, Store, StoreError};
use tempfile::TempDir;
use tokio::sync::mpsc;

/// The `hangar.yml` of the store: `beta-app` is in both categories, to check that it is linked once.
const CATEGORIES: &str = "
shared: [networks.yml]
categories:
  - name: essentials
    color: blue
    stacks: [alpha-app, beta-app]
  - name: utilities
    color: green
    stacks: [beta-app, gamma-app]
";

/// A store repository, bare, pushed to from a working copy, and a data directory to clone it into.
struct Fixture {
    _dir: TempDir,
    work: PathBuf,
    bare: PathBuf,
    store: Store<Runtime>,
}

impl Fixture {
    /// A store whose repository holds `files`, in one commit, not cloned yet.
    async fn new(files: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let work = dir.path().join("work");
        let bare = dir.path().join("store.git");
        let data_dir = DataDir::new(dir.path().join("data")).expect("the data directory resolves");

        git(
            dir.path(),
            &["init", "--quiet", "--bare", "-b", "main", path(&bare)],
        )
        .await;
        git(dir.path(), &["init", "--quiet", "-b", "main", path(&work)]).await;

        let fixture = Self {
            store: Store::new(path(&bare), data_dir, Runtime::new()),
            _dir: dir,
            work,
            bare,
        };

        fixture.commit(&[("README.md", "# A store\n")]).await;
        fixture.commit(files).await;
        fixture
    }

    /// Writes `files` in the working copy, commits them and pushes them to the bare repository.
    async fn commit(&self, files: &[(&str, &str)]) {
        if files.is_empty() {
            return;
        }

        for (file, contents) in files {
            let target = self.work.join(file);

            std::fs::create_dir_all(target.parent().expect("a file has a folder"))
                .expect("the file's folder can be made");
            std::fs::write(target, contents).expect("the file can be written");
        }

        git(&self.work, &["add", "--all"]).await;
        git(&self.work, &["commit", "--quiet", "-m", "update the store"]).await;
        git(&self.work, &["push", "--quiet", path(&self.bare), "main"]).await;
    }

    fn data_dir(&self) -> &DataDir {
        self.store.data_dir()
    }

    /// Installs the store, git's output dropped.
    async fn install(&self) -> Result<(), StoreError> {
        self.store.install(quiet()).await
    }

    /// The app ids the store lists, and whether each is installed.
    async fn apps(&self) -> Vec<(String, bool)> {
        self.store
            .apps()
            .await
            .expect("the apps can be listed")
            .into_iter()
            .map(|app| (app.id, app.installed))
            .collect()
    }

    /// Where the link of `name` in `app-installed/` leads, `None` when there is none.
    fn link(&self, name: &str) -> Option<PathBuf> {
        std::fs::read_link(self.data_dir().installed().join(name)).ok()
    }

    /// The folder or file `name` in the store's clone.
    fn in_store(&self, name: &str) -> PathBuf {
        self.data_dir().store_apps().join(name)
    }
}

/// Runs git in `dir`, with an identity and none of the user's configuration, and fails the test if it fails.
async fn git(dir: &Path, args: &[&str]) {
    let status = tokio::process::Command::new("git")
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .await
        .expect("git runs");

    assert!(status.success(), "git {args:?} failed");
}

/// A path as an argument.
fn path(path: &Path) -> &str {
    path.to_str().expect("the temporary paths are UTF-8")
}

/// An output that reads the run's lines and drops them, so that the test's own output stays clean.
fn quiet() -> Output {
    let (sender, mut receiver) = mpsc::channel(16);

    tokio::spawn(async move { while receiver.recv().await.is_some() {} });

    Output::Lines(sender)
}

/// A store with three apps, a shared file and its categories.
async fn full_store() -> Fixture {
    Fixture::new(&[
        ("config/hangar.yml", CATEGORIES),
        ("store/networks.yml", "networks:\n  web:\n    name: ${NETWORK}\n"),
        (
            "store/alpha-app/compose.yml",
            "x-hangar:\n  name: Alpha\nservices:\n  alpha-app:\n    image: alpha:${ALPHA_APP_TAG:-latest}\n    volumes:\n      - ${APP_DATA_DIR}/alpha:/data\n    environment:\n      DOMAIN: $DOMAIN\n      PRICE: $$5\n",
        ),
        ("store/beta-app/compose.yml", "services:\n  beta:\n    image: beta\n"),
        ("store/gamma-app/compose.yml", "services:\n  gamma:\n    image: gamma\n"),
        ("store/delta-app/compose.yml", "services:\n  delta:\n    image: delta:${DELTA_APP_TAG}\n"),
    ])
    .await
}

#[tokio::test]
async fn clones_the_store_and_links_the_apps_of_its_categories_with_the_shared_files() {
    let fixture = full_store().await;

    assert!(!fixture.store.is_installed().await);

    fixture.install().await.expect("the store installs");

    assert!(fixture.store.is_installed().await);
    // By their absolute path, as the Waku version links them.
    assert_eq!(
        fixture.link("alpha-app"),
        Some(fixture.in_store("alpha-app"))
    );
    assert_eq!(fixture.link("beta-app"), Some(fixture.in_store("beta-app")));
    assert_eq!(
        fixture.link("gamma-app"),
        Some(fixture.in_store("gamma-app"))
    );
    // Shared files ride along with the stacks: compose resolves them from app-installed.
    assert_eq!(
        fixture.link("networks.yml"),
        Some(fixture.in_store("networks.yml"))
    );
    assert_eq!(fixture.link("delta-app"), None, "no category lists it");
}

#[tokio::test]
async fn seeds_the_global_env_with_the_namespaced_variables_the_installed_stacks_reference() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");

    let app_data = fixture.data_dir().app_data().to_string_lossy().into_owned();
    let expected = BTreeMap::from([
        ("ALPHA_APP_TAG".to_owned(), String::new()),
        ("APP_DATA_DIR".to_owned(), app_data),
    ]);

    // DOMAIN and NETWORK belong to no app, `$$5` is an escaped dollar, and delta-app is not installed.
    assert_eq!(
        fixture.store.env().read().await.expect("the env reads"),
        expected
    );
    assert_eq!(
        fixture.store.env().required().await,
        ["ALPHA_APP_TAG", "APP_DATA_DIR", "DOMAIN", "NETWORK"]
    );
}

#[tokio::test]
async fn pulls_the_store_once_it_is_cloned() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");
    fixture
        .commit(&[
            (
                "store/epsilon-app/compose.yml",
                "services:\n  epsilon:\n    image: epsilon\n",
            ),
            (
                "config/hangar.yml",
                &format!("{CATEGORIES}  - {{ name: more, color: red, stacks: [epsilon-app] }}\n"),
            ),
        ])
        .await;
    fixture.install().await.expect("the store updates");

    assert_eq!(
        fixture.link("epsilon-app"),
        Some(fixture.in_store("epsilon-app"))
    );
}

#[tokio::test]
async fn installs_a_store_that_ships_no_config() {
    let fixture = Fixture::new(&[("store/alpha-app/compose.yml", "services: {}\n")]).await;

    fixture
        .install()
        .await
        .expect("a store without hangar.yml installs");

    assert_eq!(fixture.apps().await, [("alpha-app".to_owned(), false)]);
    assert!(
        fixture
            .store
            .config()
            .await
            .expect("no config is the default")
            .categories
            .is_empty()
    );
    assert_eq!(
        fixture
            .store
            .config_source()
            .await
            .expect("no config reads"),
        ""
    );
}

#[tokio::test]
async fn fails_with_git_s_error_when_the_store_cannot_be_cloned() {
    let fixture = full_store().await;

    std::fs::remove_dir_all(&fixture.bare).expect("the repository can be removed");

    let error = fixture
        .install()
        .await
        .expect_err("there is nothing to clone");

    assert!(
        matches!(
            error,
            StoreError::Git {
                action: "clone",
                ..
            }
        ),
        "{error:?}"
    );
    assert!(!fixture.store.is_installed().await);
}

#[tokio::test]
async fn lists_the_apps_and_the_installed_ones_without_the_shared_files() {
    let fixture = full_store().await;

    assert!(
        fixture
            .store
            .apps()
            .await
            .expect("no store lists no app")
            .is_empty()
    );

    fixture.install().await.expect("the store installs");

    let installed: Vec<String> = fixture
        .store
        .installed_apps()
        .await
        .expect("the apps can be listed")
        .into_iter()
        .map(|app| app.id)
        .collect();
    let alpha = fixture
        .store
        .apps()
        .await
        .expect("the apps can be listed")
        .into_iter()
        .find(|app| app.id == "alpha-app")
        .expect("the store has alpha-app");

    assert_eq!(
        fixture.apps().await,
        [
            ("alpha-app".to_owned(), true),
            ("beta-app".to_owned(), true),
            ("delta-app".to_owned(), false),
            ("gamma-app".to_owned(), true),
        ]
    );
    assert_eq!(installed, ["alpha-app", "beta-app", "gamma-app"]);
    assert_eq!(alpha.name, "Alpha");
    assert_eq!(alpha.container_name, "alpha-app");
}

#[tokio::test]
async fn leaves_out_an_app_whose_compose_file_cannot_be_read() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");
    std::fs::create_dir(fixture.in_store("no-compose-app")).expect("a folder can be made");
    std::fs::write(
        fixture.in_store("delta-app").join("compose.yml"),
        "services: [\n",
    )
    .expect("the compose file can be broken");

    let ids: Vec<String> = fixture.apps().await.into_iter().map(|(id, _)| id).collect();

    assert_eq!(ids, ["alpha-app", "beta-app", "gamma-app"]);
}

#[tokio::test]
async fn installs_an_app_with_its_variables_and_uninstalls_it_leaving_the_store_alone() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");
    fixture
        .store
        .install_app("delta-app")
        .await
        .expect("delta-app installs");

    assert_eq!(
        fixture.link("delta-app"),
        Some(fixture.in_store("delta-app"))
    );
    assert_eq!(
        fixture
            .store
            .env()
            .read()
            .await
            .expect("the env reads")
            .get("DELTA_APP_TAG"),
        Some(&String::new())
    );

    fixture
        .store
        .install_app("delta-app")
        .await
        .expect("installing twice changes nothing");
    fixture
        .store
        .uninstall_app("delta-app")
        .await
        .expect("delta-app uninstalls");

    assert_eq!(fixture.link("delta-app"), None);
    assert!(
        fixture.in_store("delta-app").join("compose.yml").is_file(),
        "the store keeps the app"
    );

    fixture
        .store
        .uninstall_app("delta-app")
        .await
        .expect("uninstalling twice changes nothing");
}

#[tokio::test]
async fn refuses_an_app_the_store_does_not_carry() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");

    for id in ["missing-app", "networks.yml", "../data", ""] {
        let error = fixture
            .store
            .install_app(id)
            .await
            .expect_err("the store has no such app");

        assert!(
            matches!(error, StoreError::UnknownApp { .. }),
            "{id}: {error:?}"
        );
    }
}

#[tokio::test]
async fn never_replaces_what_already_sits_in_app_installed_and_says_so() {
    let fixture = full_store().await;
    let own_folder = fixture.data_dir().installed().join("alpha-app");

    std::fs::create_dir_all(&own_folder).expect("a folder can be made");
    fixture
        .install()
        .await
        .expect("the store installs, linking the others");

    let install = fixture.store.install_app("alpha-app").await;
    let uninstall = fixture.store.uninstall_app("alpha-app").await;

    assert!(
        matches!(install, Err(StoreError::InTheWay { .. })),
        "{install:?}"
    );
    assert!(
        matches!(uninstall, Err(StoreError::InTheWay { .. })),
        "{uninstall:?}"
    );
    assert!(
        own_folder.is_dir() && fixture.link("alpha-app").is_none(),
        "the folder stays"
    );
    assert_eq!(fixture.link("beta-app"), Some(fixture.in_store("beta-app")));
}

#[tokio::test]
async fn reports_a_link_that_leads_elsewhere_and_leaves_it() {
    let fixture = full_store().await;
    let elsewhere = fixture.data_dir().root().join("elsewhere");

    std::fs::create_dir_all(&elsewhere).expect("a folder can be made");
    std::fs::create_dir_all(fixture.data_dir().installed()).expect("app-installed can be made");
    std::os::unix::fs::symlink(&elsewhere, fixture.data_dir().installed().join("delta-app"))
        .expect("a link can be made");
    fixture.install().await.expect("the store installs");

    let install = fixture.store.install_app("delta-app").await;

    assert!(
        matches!(install, Err(StoreError::InTheWay { .. })),
        "{install:?}"
    );
    assert_eq!(fixture.link("delta-app"), Some(elsewhere));
}

#[tokio::test]
async fn takes_a_relative_link_to_the_app_for_one_installed_already() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");

    let link = fixture.data_dir().installed().join("delta-app");

    std::os::unix::fs::symlink("../app-store/store/delta-app", &link).expect("a link can be made");
    fixture
        .store
        .install_app("delta-app")
        .await
        .expect("delta-app is installed already");

    assert_eq!(
        fixture.link("delta-app"),
        Some(PathBuf::from("../app-store/store/delta-app"))
    );
}

#[tokio::test]
async fn replaces_a_dangling_link_on_install_and_removes_one_on_uninstall() {
    let fixture = full_store().await;
    let installed = fixture.data_dir().installed();

    std::fs::create_dir_all(installed).expect("app-installed can be made");
    // Links written under another root, by the Waku container say, or to an app removed upstream since.
    std::os::unix::fs::symlink(
        "/elsewhere/app-store/store/alpha-app",
        installed.join("alpha-app"),
    )
    .expect("a link can be made");
    std::os::unix::fs::symlink(
        "/elsewhere/app-store/store/removed-app",
        installed.join("removed-app"),
    )
    .expect("a link can be made");
    fixture.install().await.expect("the store installs");

    assert_eq!(
        fixture.link("alpha-app"),
        Some(fixture.in_store("alpha-app"))
    );

    assert!(
        fixture
            .store
            .is_linked("removed-app")
            .await
            .expect("inspected"),
        "a dangling link is an app installed"
    );

    fixture
        .store
        .uninstall_app("removed-app")
        .await
        .expect("a dangling link uninstalls");

    assert_eq!(fixture.link("removed-app"), None);
    assert!(
        !fixture
            .store
            .is_linked("removed-app")
            .await
            .expect("inspected")
    );
    assert!(matches!(
        fixture.store.is_linked("../app-store").await,
        Err(StoreError::InvalidAppId { .. })
    ));
}

#[tokio::test]
async fn uninstalls_an_app_the_store_no_longer_reads() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");
    std::fs::write(
        fixture.in_store("alpha-app").join("compose.yml"),
        "services: [\n",
    )
    .expect("the compose file can be broken");
    std::fs::write(fixture.data_dir().config_file(), "categories: [\n")
        .expect("the config can be broken");

    fixture
        .store
        .uninstall_app("alpha-app")
        .await
        .expect("the link goes all the same");

    assert_eq!(fixture.link("alpha-app"), None);
    assert!(
        fixture.in_store("alpha-app").is_dir(),
        "the store keeps the app"
    );
}

#[tokio::test]
async fn refuses_to_uninstall_an_id_that_is_not_an_app_s() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");

    for id in ["../app-store", "networks.yml/..", "", "Alpha-App"] {
        let error = fixture
            .store
            .uninstall_app(id)
            .await
            .expect_err("the id is not an app's");

        assert!(
            matches!(error, StoreError::InvalidAppId { .. }),
            "{id:?}: {error:?}"
        );
    }

    assert_eq!(
        fixture.link("alpha-app"),
        Some(fixture.in_store("alpha-app"))
    );
}

#[tokio::test]
async fn lists_the_apps_of_a_clone_without_app_installed_and_installs_one() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");
    std::fs::remove_dir_all(fixture.data_dir().installed()).expect("app-installed can be removed");

    assert!(fixture.apps().await.iter().all(|(_, installed)| !installed));

    fixture
        .store
        .install_app("delta-app")
        .await
        .expect("app-installed is created");

    assert_eq!(
        fixture.link("delta-app"),
        Some(fixture.in_store("delta-app"))
    );
}

#[tokio::test]
async fn lists_no_app_in_a_clone_without_a_store_folder() {
    let fixture = Fixture::new(&[]).await;

    fixture
        .install()
        .await
        .expect("a repository without store/ installs");

    assert!(fixture.apps().await.is_empty());
    assert!(
        fixture
            .store
            .installed_apps()
            .await
            .expect("the apps can be listed")
            .is_empty()
    );

    let error = fixture
        .store
        .install_app("alpha-app")
        .await
        .expect_err("there is no app");

    assert!(matches!(error, StoreError::UnknownApp { .. }), "{error:?}");
}

#[tokio::test]
async fn lists_as_apps_only_the_folders_named_as_app_ids() {
    let fixture = Fixture::new(&[
        ("store/alpha-app/compose.yml", "services: {}\n"),
        ("store/README.md", "# The apps\n"),
        ("store/.github/compose.yml", "services: {}\n"),
        ("store/Jellyfin/compose.yml", "services: {}\n"),
        ("store/.tmpl/compose.yml", "services: {}\n"),
    ])
    .await;

    fixture.install().await.expect("the store installs");

    assert_eq!(fixture.apps().await, [("alpha-app".to_owned(), false)]);
}

#[tokio::test]
async fn saves_the_first_config_of_a_store_that_ships_none() {
    let fixture = Fixture::new(&[("store/alpha-app/compose.yml", "services: {}\n")]).await;

    fixture.install().await.expect("the store installs");
    fixture
        .store
        .save_config("categories:\n  - { name: a, color: blue, stacks: [alpha-app] }\n")
        .await
        .expect("config/ is created");

    assert_eq!(
        fixture.link("alpha-app"),
        Some(fixture.in_store("alpha-app"))
    );
}

#[tokio::test]
async fn refuses_to_save_a_config_before_the_store_is_cloned() {
    let fixture = full_store().await;
    let error = fixture
        .store
        .save_config("categories: []\n")
        .await
        .expect_err("there is no clone to write in");

    assert!(matches!(error, StoreError::NotInstalled), "{error:?}");
    assert!(!fixture.data_dir().store().exists());
}

#[tokio::test]
async fn saves_a_valid_config_and_links_what_it_adds() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");

    let source = format!("{CATEGORIES}  - {{ name: extra, color: red, stacks: [delta-app] }}\n");
    let config = fixture
        .store
        .save_config(&source)
        .await
        .expect("the config is valid");

    assert_eq!(config.categories.len(), 3);
    assert_eq!(
        fixture
            .store
            .config_source()
            .await
            .expect("the config reads"),
        source
    );
    assert_eq!(
        fixture.link("delta-app"),
        Some(fixture.in_store("delta-app"))
    );
}

#[tokio::test]
async fn refuses_an_invalid_config_naming_the_field_and_leaving_the_file_alone() {
    let fixture = full_store().await;

    fixture.install().await.expect("the store installs");

    let error = fixture
        .store
        .save_config("categories:\n  - name: infra\n    stacks: [traefik]\n")
        .await
        .expect_err("the category has no color");
    let StoreError::Config { path, source } = &error else {
        panic!("expected an invalid config, got {error:?}");
    };

    assert_eq!(path, fixture.data_dir().config_file());
    assert_eq!(
        source.to_string(),
        "categories[0].color: missing field `color`"
    );
    assert_eq!(
        fixture
            .store
            .config_source()
            .await
            .expect("the config reads"),
        CATEGORIES
    );
}
