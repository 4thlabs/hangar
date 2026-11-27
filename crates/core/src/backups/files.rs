//! The files of a folder that a backup archives, and the globs that pick them.

use std::ffi::OsString;
use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};

use super::BackupError;

/// A regular file a backup archives.
#[derive(Debug)]
pub(super) struct BackupFile {
    /// Its path.
    pub(super) path: PathBuf,
    /// Its path relative to the backed-up folder, with `/` separators: what the globs match and the archive names.
    pub(super) relative: String,
    /// Its metadata, read without following a link.
    pub(super) metadata: Metadata,
}

/// The files of a folder that a backup archives: the regular files `include` matches and `exclude` does not.
///
/// The globs read as the Waku version's picomatch reads them: `*` stops at a `/`, `**` crosses them, a dotfile matches
/// as any other file, as an app's data is full of them (`.config`, `.local`), and `folder/**` matches `folder` too.
///
/// A symbolic link is never followed: it could loop, or lead out of the app's data. The walk counts those it leaves
/// out, so that the report can say the archive misses them.
#[derive(Debug)]
pub(super) struct BackupFiles {
    root: PathBuf,
    include: GlobSet,
    exclude: GlobSet,
    skipped_links: u64,
}

impl BackupFiles {
    /// The files of `root` that `include` matches and `exclude` does not; an excluded folder is not walked into.
    ///
    /// # Errors
    ///
    /// [`BackupError::InvalidGlob`] for a glob globset cannot read.
    pub(super) fn new(
        root: impl Into<PathBuf>,
        include: &[String],
        exclude: &[String],
    ) -> Result<Self, BackupError> {
        Ok(Self {
            root: root.into(),
            include: Self::globs(include)?,
            exclude: Self::globs(exclude)?,
            skipped_links: 0,
        })
    }

    /// How many symbolic links the walk has left out so far.
    pub(super) fn skipped_links(&self) -> u64 {
        self.skipped_links
    }

    /// Gives each file to archive to `visit`, folder by folder, in the order of their names, until `visit` fails.
    ///
    /// # Errors
    ///
    /// [`BackupError::Io`] for a folder that cannot be read, and the errors of `visit`.
    pub(super) fn walk(
        &mut self,
        visit: &mut impl FnMut(BackupFile) -> Result<(), BackupError>,
    ) -> Result<(), BackupError> {
        self.walk_folder("", visit)
    }

    fn walk_folder(
        &mut self,
        relative_folder: &str,
        visit: &mut impl FnMut(BackupFile) -> Result<(), BackupError>,
    ) -> Result<(), BackupError> {
        let folder = self.root.join(relative_folder);

        for name in Self::names(&folder)? {
            let name_text = name.to_string_lossy();
            let relative = if relative_folder.is_empty() {
                name_text.into_owned()
            } else {
                format!("{relative_folder}/{name_text}")
            };

            if self.exclude.is_match(&relative) {
                continue;
            }

            let path = folder.join(&name);
            // Gone since the folder was read: a live app removes files at any time, a journal, a temporary file.
            let Some(metadata) = Self::unless_gone(fs::symlink_metadata(&path))
                .map_err(|error| BackupError::io("read", &path, error))?
            else {
                continue;
            };
            let kind = metadata.file_type();

            if kind.is_symlink() {
                self.skipped_links += 1;
                continue;
            }

            if kind.is_dir() {
                self.walk_folder(&relative, visit)?;
                continue;
            }

            // Sockets, pipes and devices have nothing to read.
            if !kind.is_file() || !self.include.is_match(&relative) {
                continue;
            }

            visit(BackupFile {
                path,
                relative,
                metadata,
            })?;
        }

        Ok(())
    }

    /// The names in `folder`, in order; none when it is gone.
    fn names(folder: &Path) -> Result<Vec<OsString>, BackupError> {
        let read = |error| BackupError::io("read", folder, error);
        let Some(entries) = Self::unless_gone(fs::read_dir(folder)).map_err(read)? else {
            return Ok(Vec::new());
        };
        let mut names = entries
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(read)?;

        names.sort();

        Ok(names)
    }

    /// The globs of `patterns`, each `folder/**` with `folder` beside it, which picomatch matches with it.
    fn globs(patterns: &[String]) -> Result<GlobSet, BackupError> {
        let mut set = GlobSetBuilder::new();

        for pattern in patterns {
            let folder = pattern
                .strip_suffix("/**")
                .filter(|folder| !folder.is_empty());

            for glob in std::iter::once(pattern.as_str()).chain(folder) {
                let built = GlobBuilder::new(glob)
                    .literal_separator(true)
                    .build()
                    .map_err(|source| BackupError::InvalidGlob {
                        glob: pattern.clone(),
                        source: Box::new(source),
                    })?;

                set.add(built);
            }
        }

        set.build().map_err(|source| BackupError::InvalidGlob {
            glob: patterns.join(", "),
            source: Box::new(source),
        })
    }

    /// `result`'s value, or `None` when the path it reads is gone.
    pub(super) fn unless_gone<T>(result: io::Result<T>) -> io::Result<Option<T>> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::Path;

    use super::BackupFiles;

    /// The files of `root` that `include` and `exclude` keep, by their relative paths, and the links left out.
    fn kept(root: &Path, include: &[&str], exclude: &[&str]) -> (Vec<String>, u64) {
        let strings = |globs: &[&str]| {
            globs
                .iter()
                .map(|glob| (*glob).to_owned())
                .collect::<Vec<_>>()
        };
        let mut files =
            BackupFiles::new(root, &strings(include), &strings(exclude)).expect("valid globs");
        let mut kept = Vec::new();

        files
            .walk(&mut |file| {
                kept.push(file.relative);
                Ok(())
            })
            .expect("walked");

        (kept, files.skipped_links())
    }

    /// A folder of `paths`, each a file with its own path in it.
    fn folder(paths: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temporary directory");

        for path in paths {
            let file = dir.path().join(path);

            fs::create_dir_all(file.parent().expect("a parent")).expect("created");
            fs::write(&file, path).expect("written");
        }

        dir
    }

    #[test]
    fn keeps_every_file_dotfiles_included_folder_by_folder_in_name_order() {
        let dir = folder(&["b.txt", "a/z.txt", ".config/app.ini", "a/.hidden"]);

        assert_eq!(
            kept(dir.path(), &["**"], &[]).0,
            [".config/app.ini", "a/.hidden", "a/z.txt", "b.txt"]
        );
    }

    #[test]
    fn keeps_what_include_matches_and_exclude_does_not() {
        let dir = folder(&[
            "config/app.ini",
            "config/deep/app.db",
            "config/cache/blob",
            "media/movie.mkv",
            "logs/today.log",
            "app.db",
        ]);

        assert_eq!(
            kept(dir.path(), &["config/**", "*.db"], &["**/cache/**"]).0,
            ["app.db", "config/app.ini", "config/deep/app.db"]
        );
        assert_eq!(
            kept(dir.path(), &["**"], &["media", "**/*.log", "config/*.ini"]).0,
            ["app.db", "config/cache/blob", "config/deep/app.db"],
            "* stops at a /"
        );
    }

    #[test]
    fn excludes_a_folder_itself_with_its_globstar_as_picomatch_does() {
        let dir = folder(&["data/keep.txt", "cache/blob", "logs"]);

        symlink("/etc", dir.path().join("media")).expect("linked");

        let (files, skipped) = kept(dir.path(), &["**"], &["cache/**", "media/**", "logs/**"]);

        assert_eq!(
            files,
            ["data/keep.txt"],
            "a file named as the folder goes too"
        );
        assert_eq!(skipped, 0, "the excluded link to a folder is not counted");
    }

    #[test]
    fn follows_no_link_and_counts_those_it_leaves_out() {
        let dir = folder(&["data/real.txt"]);
        let outside = folder(&["secret.txt"]);

        symlink(outside.path(), dir.path().join("data/out")).expect("linked");
        symlink(
            dir.path().join("data/real.txt"),
            dir.path().join("data/alias.txt"),
        )
        .expect("linked");
        symlink(dir.path(), dir.path().join("data/loop")).expect("linked");

        let (files, skipped) = kept(dir.path(), &["**"], &[]);

        assert_eq!(files, ["data/real.txt"]);
        assert_eq!(skipped, 3);
    }

    #[test]
    fn refuses_a_glob_it_cannot_read() {
        let refused = BackupFiles::new("/", &["a[".to_owned()], &[]);

        assert!(matches!(
            refused,
            Err(super::BackupError::InvalidGlob { glob, .. }) if glob == "a["
        ));
    }
}
