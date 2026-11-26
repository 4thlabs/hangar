//! The routes of the group `Editor`: an app's files, listed, read, created and written once checked, and a new app.
//! What changes the store takes its turn among its changes, and is refused while a sync runs.

use hangar_api::{
    AppFile, AppFileList, EditorServer, ErrorCode, FileSource, NewApp, SavedFile, StoreApp,
};
use hangar_core::StoreError;
use quoll::{Error, Response, Result};

use super::StoreState;
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl StoreState {
    /// Creates the app `new`, then answers it as the store now reads it.
    async fn create_app(&self, new: &NewApp) -> Result<StoreApp> {
        let _change = self.change().await?;
        let failed = || ErrorCode::AppCreateFailed {
            app: new.id.clone(),
        };

        // An id that is no app's yet: the page's to fix, as a shared file's is the store's already.
        self.store
            .create_app(&new.id, &new.compose)
            .await
            .map_err(|error| match error {
                StoreError::InvalidAppId { id } => ErrorCode::InvalidAppId { app: id }.into(),
                StoreError::SharedFile { id } => ErrorCode::AppExists { app: id }.into(),
                other => Self::refusal(other, failed()),
            })?;
        tracing::info!(app = %new.id, "an app was created");

        // Created, whatever the listing says now: a retry would find its id taken.
        self.edited(&new.id, failed()).await
    }

    /// The app `id`, and the files the editor may open: those of its folder, whether its `compose.yml` parses or not,
    /// as fixing it is what the editor is for.
    async fn app_files(&self, id: &str) -> Result<AppFileList> {
        let failed = || ErrorCode::FilesUnreadable { app: id.to_owned() };
        let files = self
            .store
            .files(id)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;

        Ok(AppFileList {
            app: self.edited(id, failed()).await?,
            files: files.list().await,
        })
    }

    /// The app `id`, whose folder is in the store, as the store lists it, or by its id alone when the store does not,
    /// its `compose.yml` broken say.
    async fn edited(&self, id: &str, failed: ErrorCode) -> Result<StoreApp> {
        if let Some(app) = self.find(id).await? {
            return Ok(app);
        }

        let installed = self
            .store
            .is_linked(id)
            .await
            .map_err(|error| Failure::logged(failed, &error))?;

        Ok(StoreApp {
            id: id.to_owned(),
            name: id.to_owned(),
            icon: None,
            installed,
            swarm_ready: false,
        })
    }

    /// The text of the file `path` of the app `id`.
    async fn read_file(&self, id: &str, path: &str) -> Result<AppFile> {
        let failed = || ErrorCode::FileReadFailed {
            path: path.to_owned(),
        };
        let files = self
            .store
            .files(id)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;
        let source = files
            .read(path)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;

        Ok(AppFile {
            path: path.to_owned(),
            source,
        })
    }

    /// Creates the file `path` of the app `id`, empty.
    async fn create_file(&self, id: &str, path: &str) -> Result<AppFile> {
        let _change = self.change().await?;
        let failed = || ErrorCode::FileSaveFailed {
            path: path.to_owned(),
        };
        let files = self
            .store
            .files(id)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;

        files
            .create(path)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;
        tracing::info!(app = %id, path, "a file of an app was created");

        Ok(AppFile {
            path: path.to_owned(),
            source: String::new(),
        })
    }

    /// Writes `source` to the file `path` of the app `id`, once checked.
    async fn write_file(&self, id: &str, path: &str, source: &str) -> Result<SavedFile> {
        let _change = self.change().await?;
        let failed = || ErrorCode::FileSaveFailed {
            path: path.to_owned(),
        };
        let files = self
            .store
            .files(id)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;
        let saved = files
            .write(path, source)
            .await
            .map_err(|error| Self::refusal(error, failed()))?;

        tracing::info!(app = %id, path, "a file of an app was saved");

        Ok(SavedFile {
            compose_changed: saved.compose_changed,
        })
    }

    /// The answer of the store's `error` to the editor: what is the operator's to fix, with its code, and any other
    /// failure as `failed`, once logged whole.
    fn refusal(error: StoreError, failed: ErrorCode) -> Error {
        let code = match error {
            // An id that is not an app's, as a shared file, names no app the store carries.
            StoreError::InvalidAppId { id }
            | StoreError::SharedFile { id }
            | StoreError::UnknownApp { id } => return Self::unknown(&id),
            StoreError::NotInstalled => ErrorCode::StoreNotInstalled,
            StoreError::Config { source, .. } => Failure::config(&source),
            StoreError::AppExists { id } => ErrorCode::AppExists { app: id },
            StoreError::InvalidPath { path } => ErrorCode::InvalidPath { path },
            StoreError::ThroughFile { path } => ErrorCode::ThroughFile { path },
            StoreError::OutsideApp { app, path } => {
                tracing::warn!(%app, path = ?path, "a path out of an app's folder was refused");

                ErrorCode::OutsideApp { app, path }
            }
            StoreError::BrokenSymlink { path } => ErrorCode::BrokenSymlink { path },
            StoreError::HiddenFile { path } => ErrorCode::HiddenFile { path },
            StoreError::NoSuchFile { app, path } => ErrorCode::NoSuchFile { app, path },
            StoreError::NotAFile { path } => ErrorCode::NotAFile { path },
            StoreError::TooLarge { path, size } => ErrorCode::TooLarge { path, size },
            StoreError::Binary { path } => ErrorCode::BinaryFile { path },
            StoreError::NotUtf8Text { path } => ErrorCode::NotUtf8Text { path },
            StoreError::FileExists { path } => ErrorCode::FileExists { path },
            StoreError::FileAppeared { path } => ErrorCode::FileAppeared { path },
            StoreError::InvalidFile { path, reason } => ErrorCode::InvalidFile { path, reason },
            // Docker's complaint is about the operator's own file, and says what to fix in it: the page shows it,
            // the credentials of a URL taken out.
            StoreError::Rejected {
                path, complaint, ..
            } => ErrorCode::ComposeRejected {
                complaint: Failure::redacted(&complaint).into_owned(),
                path,
            },
            StoreError::Unchecked { ref path, .. } => {
                let unchecked = ErrorCode::FileUnchecked { path: path.clone() };

                return Failure::logged(unchecked, &error);
            }
            other => return Failure::logged(failed, &other),
        };

        code.into()
    }
}

impl EditorServer for App {
    async fn create_app(&self, _: &SignedIn, app: NewApp) -> Result<Response<StoreApp>> {
        Ok(Response::new(self.store.create_app(&app).await?))
    }

    async fn files(&self, _: &SignedIn, id: String) -> Result<Response<AppFileList>> {
        Ok(Response::new(self.store.app_files(&id).await?))
    }

    async fn read(&self, _: &SignedIn, id: String, path: String) -> Result<Response<AppFile>> {
        Ok(Response::new(self.store.read_file(&id, &path).await?))
    }

    async fn create(&self, _: &SignedIn, id: String, path: String) -> Result<Response<AppFile>> {
        Ok(Response::new(self.store.create_file(&id, &path).await?))
    }

    async fn write(
        &self,
        _: &SignedIn,
        id: String,
        path: String,
        file: FileSource,
    ) -> Result<Response<SavedFile>> {
        Ok(Response::new(
            self.store.write_file(&id, &path, &file.source).await?,
        ))
    }
}
