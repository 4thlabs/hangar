//! The zip of a backup: the files of the backed-up folder written into a new archive, as blocking work.

use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Read};
use std::path::Path;

use tokio_util::sync::CancellationToken;
use zip::write::{FullFileOptions, SimpleFileOptions};
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

    /// Writes `files` into a new zip at `target`, which must not exist, and gives how many files it holds.
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
            self.add(&mut zip, file, target)?;
            count += 1;

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

    /// Adds `file` to `zip`, under its name's bytes as the system gives them.
    fn add(
        &self,
        zip: &mut ZipWriter<BufWriter<File>>,
        file: BackupFile,
        target: &Path,
    ) -> Result<(), BackupError> {
        let zipped = |error| BackupError::io("write", target, error);

        if self.cancel.is_cancelled() {
            return Err(zipped(canceled()));
        }

        let name = [self.prefix.as_bytes(), b"/", &file.relative].concat();
        let options = Self::options(&file)
            .map_err(|error| zipped(io::Error::other(error)))?
            .name(&name);

        zip.start_file_with_options(options)
            .map_err(|error| zipped(io::Error::other(error)))?;

        let mut reader = Cancellable {
            inner: file.file,
            cancel: self.cancel,
        };

        io::copy(&mut reader, zip).map_err(zipped)?;

        Ok(())
    }

    /// The options of `file`'s entry: deflated, with its mode and the time it was changed at, as a DOS time in UTC and
    /// as an extended timestamp, which readers take over the DOS time, which has no time zone.
    fn options(file: &BackupFile) -> zip::result::ZipResult<FullFileOptions<'static, 'static>> {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(file.mode)
            .large_file(file.size >= Self::LARGE_FILE);
        let options = match Self::dos_time(file.modified) {
            Some(time) => options.last_modified_time(time),
            None => options,
        };

        options.with_extended_timestamp(u32::try_from(file.modified).ok(), None, None)
    }

    /// `seconds` since 1970 as a DOS time in UTC, which holds 1980 to 2107 and even seconds: `None` out of its range.
    fn dos_time(seconds: i64) -> Option<DateTime> {
        let utc = jiff::Timestamp::from_second(seconds)
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
