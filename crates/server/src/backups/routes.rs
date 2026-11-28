//! The routes of the group `Backups`: the backups of an app, one asked for now, and its archives downloaded or
//! removed.

use std::io;
use std::path::Path;

use futures::{Stream, stream};
use hangar_api::{BackupStatus, BackupsServer, ErrorCode, Job, JobRun};
use hangar_core::BackupError;
use http::header::{CACHE_CONTROL, CONTENT_DISPOSITION};
use quoll::{ByteStream, Error, Response, Result};
use tokio::io::AsyncReadExt;

use super::Backups;
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl Backups {
    /// How many bytes of an archive are read at a time, to send.
    const CHUNK: usize = 64 * 1024;

    /// The archive at `path`, opened, and its length, read from the file opened.
    async fn open(path: &Path) -> io::Result<(tokio::fs::File, u64)> {
        let file = tokio::fs::File::open(path).await?;
        let length = file.metadata().await?.len();

        Ok((file, length))
    }

    /// The chunks of `file`, read as they are sent.
    fn chunks(file: tokio::fs::File) -> impl Stream<Item = Result<Vec<u8>>> + Send + 'static {
        stream::try_unfold(file, |mut file| async move {
            let mut chunk = vec![0; Self::CHUNK];
            let read = file
                .read(&mut chunk)
                .await
                .map_err(|error| Error::internal(format!("could not read an archive: {error}")))?;

            if read == 0 {
                return Ok(None);
            }

            chunk.truncate(read);

            Ok(Some((chunk, file)))
        })
    }

    /// The answer of `error`, of the archive `archive` of `app`: a 404 for an archive that cannot be there or is not,
    /// else `failed`, once `error` is logged.
    fn archive_error(error: &BackupError, app: &str, archive: &str, failed: ErrorCode) -> Error {
        match error {
            BackupError::InvalidApp { .. }
            | BackupError::InvalidArchive { .. }
            | BackupError::UnknownArchive { .. } => ErrorCode::UnknownArchive {
                app: app.to_owned(),
                archive: archive.to_owned(),
            }
            .into(),
            // Any other is the server's failure.
            BackupError::NoDataFolder { .. }
            | BackupError::OutsideAppData { .. }
            | BackupError::LinkedFolder { .. }
            | BackupError::InvalidGlob { .. }
            | BackupError::RunsHangar { .. }
            | BackupError::NotStopped { .. }
            | BackupError::UnreadableServices { .. }
            | BackupError::NotRestarted { .. }
            | BackupError::Canceled { .. }
            | BackupError::Io { .. }
            | BackupError::Crashed { .. } => Failure::logged(failed, error),
        }
    }
}

impl BackupsServer for App {
    async fn status(&self, _: &SignedIn, app: String) -> Result<Response<BackupStatus>> {
        let config = self.backups.config().await?;
        let archives = match self.backups.backups.list(&app).await {
            Ok(archives) => archives
                .into_iter()
                .map(|archive| hangar_api::BackupArchive {
                    name: archive.name,
                    size: archive.size,
                    created_at: archive.created_at,
                })
                .collect(),
            // A name that is no app's, as a project Hangar does not manage: it has no backup.
            Err(BackupError::InvalidApp { .. }) => Vec::new(),
            Err(error) => {
                return Err(Failure::logged(
                    ErrorCode::BackupsUnreadable { app },
                    &error,
                ));
            }
        };

        Ok(Response::new(BackupStatus {
            plan: config.backup(&app).map(Backups::plan),
            run: self.jobs.active(&Job::Backup { app }),
            archives,
        }))
    }

    async fn back_up(&self, _: &SignedIn, app: String) -> Result<Response<JobRun>> {
        self.backups.declared(&app).await?;

        let Some(run) = self.jobs.try_enqueue(Job::Backup { app: app.clone() }) else {
            tracing::warn!(%app, "a backup was refused: one waits or runs");

            return Err(ErrorCode::BackupQueued { app }.into());
        };

        tracing::info!(%app, run = run.id, "a backup is asked for");

        Ok(Response::new(run))
    }

    async fn download(
        &self,
        _: &SignedIn,
        app: String,
        archive: String,
    ) -> Result<Response<ByteStream>> {
        let unreadable = || ErrorCode::BackupsUnreadable { app: app.clone() };
        let found = self
            .backups
            .backups
            .file(&app, &archive)
            .await
            .map_err(|error| Backups::archive_error(&error, &app, &archive, unreadable()))?;
        let (file, length) = match Backups::open(&found.path).await {
            Ok(opened) => opened,
            // Pruned by a backup once found.
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(ErrorCode::UnknownArchive { app, archive }.into());
            }
            Err(error) => return Err(Failure::logged(unreadable(), &error)),
        };
        let body = ByteStream::try_new(Backups::chunks(file))
            .with_content_type("application/zip")
            .with_length(length);

        Ok(Response::new(body)
            .header(
                CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", found.download_name),
            )
            .header(CACHE_CONTROL, "private, no-store"))
    }

    async fn remove(&self, _: &SignedIn, app: String, archive: String) -> Result<Response<()>> {
        self.backups
            .backups
            .remove(&app, &archive)
            .await
            .map_err(|error| {
                let failed = ErrorCode::ArchiveRemoveFailed {
                    app: app.clone(),
                    archive: archive.clone(),
                };

                Backups::archive_error(&error, &app, &archive, failed)
            })?;

        Ok(Response::new(()))
    }
}
