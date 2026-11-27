//! The zip of a backup: the files of the backed-up folder written into a new archive, as blocking work.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Read};
use std::path::Path;

use tokio_util::sync::CancellationToken;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

use super::BackupError;
use super::files::{BackupFile, BackupFiles};

/// Writes the files of a [`BackupFiles`] into a new zip.
pub(super) struct Archive<'a> {
    /// What every entry's name starts with: the backed-up folder, relative to `app-data/`.
    prefix: &'a str,
    /// Cancelled to stop between two reads.
    cancel: &'a CancellationToken,
}

impl<'a> Archive<'a> {
    /// A file past this size is written with zip64's sizes: it may still grow past 4 GiB while it is read.
    const LARGE_FILE: u64 = 1 << 31;

    /// An archive whose entries are named `<prefix>/<relative path>`, stopped once `cancel` is cancelled.
    pub(super) fn new(prefix: &'a str, cancel: &'a CancellationToken) -> Self {
        Self { prefix, cancel }
    }

    /// Writes `files` into a new zip at `target`, which must not exist, and gives how many files it holds. A file gone
    /// since the walk listed it is passed over.
    ///
    /// # Errors
    ///
    /// [`BackupError::Io`] for a file that cannot be read or an archive that cannot be written, and once canceled:
    /// the caller tells that one by its token. `target` is left as it is, for the caller to remove.
    pub(super) fn write(&self, files: &mut BackupFiles, target: &Path) -> Result<u64, BackupError> {
        let written = |error| BackupError::io("write", target, error);
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(written)?;
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let mut count = 0;

        files.walk(&mut |file| {
            if self.add(&mut zip, &file, target)? {
                count += 1;
            }

            Ok(())
        })?;

        let output = zip
            .finish()
            .map_err(|error| written(io::Error::other(error)))?;
        let file = output
            .into_inner()
            .map_err(|error| written(error.into_error()))?;

        file.sync_all().map_err(written)?;

        Ok(count)
    }

    /// Adds `file` to `zip`, and says whether it did: not when it is gone since the walk.
    fn add(
        &self,
        zip: &mut ZipWriter<BufWriter<File>>,
        file: &BackupFile,
        target: &Path,
    ) -> Result<bool, BackupError> {
        if self.cancel.is_cancelled() {
            return Err(BackupError::io("write", target, canceled()));
        }

        // Opened only now, once the previous file is in: one file open at a time.
        let Some(source) = BackupFiles::unless_gone(Self::open(&file.path))
            .map_err(|error| BackupError::io("read", &file.path, error))?
        else {
            return Ok(false);
        };
        let options = self.options(file);

        zip.start_file(format!("{}/{}", self.prefix, file.relative), options)
            .map_err(|error| BackupError::io("write", target, io::Error::other(error)))?;

        let mut reader = Cancellable {
            inner: source,
            cancel: self.cancel,
        };

        io::copy(&mut reader, zip)
            .map_err(|error| BackupError::io("archive", &file.path, error))?;

        Ok(true)
    }

    /// The options of `file`'s entry: deflated, with its mode and the time it was changed at, in UTC.
    fn options(&self, file: &BackupFile) -> SimpleFileOptions {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(file.metadata.len() >= Self::LARGE_FILE);
        let options = match Self::mode(&file.metadata) {
            Some(mode) => options.unix_permissions(mode),
            None => options,
        };

        match file.metadata.modified().ok().and_then(Self::zip_time) {
            Some(time) => options.last_modified_time(time),
            None => options,
        }
    }

    /// `time` as a zip writes it, which holds 1980 to 2107 and even seconds: `None` out of its range.
    fn zip_time(time: std::time::SystemTime) -> Option<DateTime> {
        let utc = jiff::Timestamp::try_from(time)
            .ok()?
            .to_zoned(jiff::tz::TimeZone::UTC);
        let field = |value: i8| u8::try_from(value).ok();

        DateTime::from_date_and_time(
            u16::try_from(utc.year()).ok()?,
            field(utc.month())?,
            field(utc.day())?,
            field(utc.hour())?,
            field(utc.minute())?,
            field(utc.second())?,
        )
        .ok()
    }

    /// The permissions of a file, on Unix.
    #[cfg(unix)]
    fn mode(metadata: &fs::Metadata) -> Option<u32> {
        use std::os::unix::fs::PermissionsExt;

        Some(metadata.permissions().mode() & 0o7777)
    }

    #[cfg(not(unix))]
    fn mode(_: &fs::Metadata) -> Option<u32> {
        None
    }

    /// Opens `path` to read, never through a link: one put in the place of the file since the walk is refused.
    #[cfg(unix)]
    fn open(path: &Path) -> io::Result<File> {
        use std::os::unix::fs::OpenOptionsExt;

        OpenOptions::new()
            .read(true)
            .custom_flags(nix::fcntl::OFlag::O_NOFOLLOW.bits())
            .open(path)
    }

    #[cfg(not(unix))]
    fn open(path: &Path) -> io::Result<File> {
        File::open(path)
    }
}

/// A reader that fails once its token is cancelled, so that a large file stops between two reads.
struct Cancellable<'a, R> {
    inner: R,
    cancel: &'a CancellationToken,
}

impl<R: Read> Read for Cancellable<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(canceled());
        }

        self.inner.read(buf)
    }
}

/// The error of a read once canceled; not [`io::ErrorKind::Interrupted`], which `io::copy` reads again after.
fn canceled() -> io::Error {
    io::Error::other("the backup was canceled")
}
