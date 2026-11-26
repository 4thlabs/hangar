//! The app editor: the files of a store app, listed, read, created and written once checked, and a new app created
//! from its `compose.yml`. A file is named by its path in the app's folder, as `config/settings.yml`.

use quoll::Created;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::StoreApp;

/// An app as the editor opens it: the app, and the files it may edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AppFileList {
    /// The app.
    pub app: StoreApp,
    /// Its text files, by their paths in its folder, sorted: no hidden file, binary, symlink or file over 1 MiB, 5
    /// folders deep and 500 files at most.
    pub files: Vec<String>,
}

/// A file of an app, and its text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AppFile {
    /// Its path in the app's folder.
    pub path: String,
    /// Its text.
    pub source: String,
}

/// The text a file is saved with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct FileSource {
    /// The file's new text.
    pub source: String,
}

/// What a save of a file did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    /// Whether it wrote one of the app's compose files, whatever path led to it: the app's name or icon may have
    /// changed, and whether it can run in the swarm.
    pub compose_changed: bool,
}

/// A new app: its id, and its `compose.yml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct NewApp {
    /// Its id: its folder under `store/`, lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a
    /// digit.
    pub id: String,
    /// Its `compose.yml`.
    pub compose: String,
}

quoll::group! {
    /// The app editor: an app's files, and a new app.
    #[auth(crate::Session)]
    pub group Editor {
        /// Creates an app from its `compose.yml`, once `docker compose config` accepts it; a file refused creates
        /// nothing. A 409 when its id is taken, or while a sync of the store runs.
        POST "/store/apps" => create_app(app: &NewApp) -> Created<StoreApp>;

        /// The app, and the files the editor may open. A 404 for an app the store does not carry.
        GET "/store/apps/{id}/files" => files(id: &str) -> AppFileList;

        /// One file of the app. A 404 when it is not there; a 400 for a path that leaves the app's folder, or a file
        /// the editor does not open: not a regular file, over 1 MiB, binary, or not UTF-8.
        GET "/store/apps/{id}/file?path={path}" => read(id: &str, path: &str) -> AppFile;

        /// Creates the file empty, and its folders. A 409 when anything is there, a hidden file included.
        POST "/store/apps/{id}/file?path={path}" => create(id: &str, path: &str) -> Created<AppFile>;

        /// Writes the file, or creates it, once checked: `docker compose config` for `compose.yml`, `docker stack
        /// config` for `compose.swarm.yml` and for `compose.yml` beside one with content, a parse for a YAML or `.env`
        /// file. A file refused is a 400 that says why, Docker's complaint included, and is left as it was. A 409
        /// while a sync of the store runs.
        PUT "/store/apps/{id}/file?path={path}" => write(id: &str, path: &str, file: &FileSource) -> SavedFile;
    }
}
