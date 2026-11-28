//! The files of a folder that a backup archives, the globs that pick them, and the walk that opens them through the
//! descriptors of their folders, never through a link.

use std::ffi::{CString, OsStr};
use std::fs::File;
use std::io;
use std::os::fd::AsFd;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use nix::dir::Dir;
use nix::errno::Errno;
use nix::fcntl::{self, AtFlags, OFlag};
use nix::sys::stat::{self, FileStat, Mode, SFlag};

use tokio_util::sync::CancellationToken;

use super::BackupError;

/// A regular file a backup archives, open.
#[derive(Debug)]
pub(super) struct BackupFile {
    /// The file, opened through its folder's descriptor.
    pub(super) file: File,
    /// Its path relative to the backed-up folder, with `/` separators, its bytes as the system gives them: what the
    /// globs match and the archive names.
    pub(super) relative: Vec<u8>,
    /// Its size when it was opened, in bytes.
    pub(super) size: u64,
    /// Its permissions, as `0o644`.
    pub(super) mode: u32,
    /// When it was last changed, in seconds since 1970.
    pub(super) modified: i64,
}

/// What a name of a folder turned out to be when it was opened.
#[derive(Debug)]
pub(super) enum Opened<T> {
    /// What was asked for, open.
    Open(T),
    /// A symbolic link, not followed.
    Link,
    /// A FIFO, a socket or a device, which has nothing to read, or a folder that is not one any more.
    Special,
    /// Gone since the folder was read.
    Gone,
}

/// The files of a folder that a backup archives: the regular files `include` matches and `exclude` does not.
///
/// The globs read as the Waku version's picomatch reads them with `dot: true`, for the globs both read alike: `*`
/// stops at a `/`, `**` crosses them, `{a,b}` and `[ab]` pick, a dotfile matches as any other file, as an app's data is
/// full of them (`.config`, `.local`), `folder/**` matches `folder` too, and a leading `./` is dropped. The globs they
/// read otherwise, a negation (`!media/**`) and an extglob (`+(a|b)`), are refused rather than read another way.
///
/// The walk opens each folder and each file through the descriptor of the folder it is in, never following a link:
/// one put in place of a folder or a file while the app runs is left out, as one there from the start, and counted. No
/// link is followed in the path of the backed-up folder either.
/// A FIFO, a socket or a device is left out too, and counted, as it has nothing to read.
#[derive(Debug)]
pub(super) struct BackupFiles {
    /// The backed-up folder, open.
    root: Dir,
    /// Its path, for the errors.
    root_path: PathBuf,
    include: GlobSet,
    exclude: GlobSet,
    skipped_links: u64,
    skipped_special: u64,
}

/// A folder the walk is in: its descriptor, the names left to see in it, and where its path ends.
#[derive(Debug)]
struct Walked {
    folder: Dir,
    names: std::vec::IntoIter<CString>,
    path_len: usize,
}

impl BackupFiles {
    /// The extglobs picomatch reads, which globset would read as plain characters.
    const EXTGLOBS: [&str; 5] = ["!(", "@(", "+(", "*(", "?("];

    /// The flags a folder is opened with.
    const FOLDER: OFlag = OFlag::O_RDONLY
        .union(OFlag::O_DIRECTORY)
        .union(OFlag::O_CLOEXEC);

    /// The files of `root`, the backed-up folder, open, that `include` matches and `exclude` does not; an excluded
    /// folder is not walked into.
    ///
    /// # Errors
    ///
    /// [`BackupError::InvalidGlob`] for a glob globset cannot read, or that picomatch would read another way.
    pub(super) fn new(
        root: Dir,
        root_path: PathBuf,
        include: &[String],
        exclude: &[String],
    ) -> Result<Self, BackupError> {
        Ok(Self {
            root,
            root_path,
            include: Self::globs(include)?,
            exclude: Self::globs(exclude)?,
            skipped_links: 0,
            skipped_special: 0,
        })
    }

    /// Opens the folder `prefix` of `app_data`, the folder to back up, one folder of its path at a time, each through
    /// the descriptor of the one before and without following a link: no other system call reads the path again
    /// after. `app_data` itself, Hangar's own, is opened by its path.
    ///
    /// # Errors
    ///
    /// [`BackupError::NoDataFolder`] when the folder is not there or is not a folder, [`BackupError::LinkedFolder`]
    /// when a link is anywhere in its path, [`BackupError::OutsideAppData`] for a path with an empty, `.` or `..`
    /// folder, which `hangar.yml` refuses already, and [`BackupError::Io`] when a folder cannot be opened.
    pub(super) fn open_root(app_data: &Path, app: &str, prefix: &str) -> Result<Dir, BackupError> {
        let folder = app_data.join(prefix);
        let missing = || BackupError::NoDataFolder {
            app: app.to_owned(),
            folder: folder.clone(),
        };

        if prefix
            .split('/')
            .any(|segment| matches!(segment, "" | "." | ".."))
        {
            return Err(BackupError::OutsideAppData {
                app: app.to_owned(),
                folder,
            });
        }

        let mut current =
            Dir::open(app_data, Self::FOLDER, Mode::empty()).map_err(|errno| match errno {
                Errno::ENOENT | Errno::ENOTDIR => missing(),
                errno => BackupError::io("open", app_data, errno.into()),
            })?;

        for segment in prefix.split('/') {
            // A name with a NUL byte names no file.
            let name = CString::new(segment).map_err(|_| missing())?;

            current = match Self::open_folder(&current, &name)
                .map_err(|errno| BackupError::io("open", &folder, errno.into()))?
            {
                Opened::Open(next) => next,
                Opened::Link => {
                    return Err(BackupError::LinkedFolder {
                        app: app.to_owned(),
                        folder,
                    });
                }
                Opened::Special | Opened::Gone => return Err(missing()),
            };
        }

        Ok(current)
    }

    /// How many symbolic links the walk has left out so far.
    pub(super) fn skipped_links(&self) -> u64 {
        self.skipped_links
    }

    /// How many FIFOs, sockets and devices the globs matched that the walk has left out so far.
    pub(super) fn skipped_special(&self) -> u64 {
        self.skipped_special
    }

    /// Gives each file to archive to `visit`, open, folder by folder, in the order of their names, until `visit`
    /// fails or `cancel` is cancelled, which it checks at each folder. The folders being walked wait on a stack of the
    /// heap, whatever their depth: each holds its descriptor and the names left to see.
    ///
    /// # Errors
    ///
    /// [`BackupError::Io`] for a folder or a file that cannot be read, and once canceled: the caller tells that one by
    /// its token. And the errors of `visit`.
    pub(super) fn walk(
        &mut self,
        cancel: &CancellationToken,
        visit: &mut impl FnMut(BackupFile) -> Result<(), BackupError>,
    ) -> Result<(), BackupError> {
        let root = nix::unistd::dup(&self.root)
            .and_then(Dir::from_fd)
            .map_err(|errno| BackupError::io("read", &self.root_path, errno.into()))?;
        // The path of the name being seen, relative to the root: each folder on the stack keeps where its own ends.
        let mut path = Vec::new();
        let mut stack = vec![self.folder(root, 0, &path, cancel)?];

        while let Some(top) = stack.last_mut() {
            let Some(name) = top.names.next() else {
                stack.pop();
                continue;
            };

            path.truncate(top.path_len);

            if top.path_len > 0 {
                path.push(b'/');
            }

            path.extend_from_slice(name.as_bytes());

            let matched = |globs: &GlobSet| globs.is_match(Path::new(OsStr::from_bytes(&path)));

            if matched(&self.exclude) {
                continue;
            }

            let is_included = matched(&self.include);
            let read = |errno: Errno| BackupError::io("read", self.path_of(&path), errno.into());
            let stat =
                match stat::fstatat(&top.folder, name.as_c_str(), AtFlags::AT_SYMLINK_NOFOLLOW) {
                    Ok(stat) => stat,
                    // Gone since the folder was read: a live app removes files at any time, a journal, a temporary file.
                    Err(Errno::ENOENT) => continue,
                    Err(errno) => return Err(read(errno)),
                };

            match Self::kind(&stat) {
                SFlag::S_IFLNK => self.skipped_links += 1,
                SFlag::S_IFDIR => match Self::open_folder(&top.folder, &name).map_err(read)? {
                    Opened::Open(child) => {
                        let folder = self.folder(child, path.len(), &path, cancel)?;

                        stack.push(folder);
                    }
                    Opened::Link => self.skipped_links += 1,
                    Opened::Special | Opened::Gone => {}
                },
                SFlag::S_IFREG if is_included => {
                    match Self::open_file(&top.folder, &name).map_err(read)? {
                        Opened::Open((file, stat)) => visit(BackupFile {
                            file,
                            relative: path.clone(),
                            size: u64::try_from(stat.st_size).unwrap_or(0),
                            mode: Self::mode(&stat),
                            modified: stat.st_mtime,
                        })?,
                        Opened::Link => self.skipped_links += 1,
                        Opened::Special => self.skipped_special += 1,
                        Opened::Gone => {}
                    }
                }
                SFlag::S_IFREG => {}
                // Sockets, FIFOs and devices have nothing to read.
                _ if is_included => self.skipped_special += 1,
                _ => {}
            }
        }

        Ok(())
    }

    /// The folder `folder`, open, at `path`, which ends at `path_len`, with its names in order, `.` and `..` left out;
    /// once `cancel` is cancelled, the error that stops the walk.
    fn folder(
        &self,
        mut folder: Dir,
        path_len: usize,
        path: &[u8],
        cancel: &CancellationToken,
    ) -> Result<Walked, BackupError> {
        let read = |error| BackupError::io("read", self.path_of(path), error);

        if cancel.is_cancelled() {
            return Err(read(io::Error::other("the backup was canceled")));
        }

        let mut names = Vec::new();

        for entry in folder.iter() {
            let name = entry
                .map_err(|errno| read(errno.into()))?
                .file_name()
                .to_owned();

            if !matches!(name.as_bytes(), b"." | b"..") {
                names.push(name);
            }
        }

        names.sort();

        Ok(Walked {
            folder,
            names: names.into_iter(),
            path_len,
        })
    }

    /// Opens the folder `name` of `folder`, unless it is a link or no folder any more.
    pub(super) fn open_folder(folder: &impl AsFd, name: &CString) -> nix::Result<Opened<Dir>> {
        match fcntl::openat(
            folder,
            name.as_c_str(),
            Self::FOLDER | OFlag::O_NOFOLLOW,
            Mode::empty(),
        ) {
            Ok(fd) => Dir::from_fd(fd).map(Opened::Open),
            // Linux answers `ENOTDIR` for a link, as `O_DIRECTORY` is checked first: what is there now tells which.
            Err(Errno::ELOOP | Errno::ENOTDIR) => {
                match stat::fstatat(folder, name.as_c_str(), AtFlags::AT_SYMLINK_NOFOLLOW) {
                    Ok(stat) if Self::kind(&stat) == SFlag::S_IFLNK => Ok(Opened::Link),
                    Ok(_) => Ok(Opened::Special),
                    Err(Errno::ENOENT) => Ok(Opened::Gone),
                    Err(errno) => Err(errno),
                }
            }
            Err(Errno::ENOENT) => Ok(Opened::Gone),
            Err(errno) => Err(errno),
        }
    }

    /// Opens the file `name` of `folder` to read, with what `fstat` says of it, unless it is a link or no regular file
    /// any more. Opened `O_NONBLOCK`, so that a FIFO put in its place does not wait for a writer, which `fstat` then
    /// leaves out, and read without it once `fstat` says it is a regular file.
    pub(super) fn open_file(
        folder: &impl AsFd,
        name: &CString,
    ) -> nix::Result<Opened<(File, FileStat)>> {
        let flags = OFlag::O_RDONLY
            | OFlag::O_NOFOLLOW
            | OFlag::O_NONBLOCK
            | OFlag::O_NOCTTY
            | OFlag::O_CLOEXEC;
        let fd = match fcntl::openat(folder, name.as_c_str(), flags, Mode::empty()) {
            Ok(fd) => fd,
            Err(Errno::ELOOP) => return Ok(Opened::Link),
            Err(Errno::ENXIO) => return Ok(Opened::Special),
            Err(Errno::ENOENT) => return Ok(Opened::Gone),
            Err(errno) => return Err(errno),
        };
        let stat = stat::fstat(&fd)?;

        if Self::kind(&stat) != SFlag::S_IFREG {
            return Ok(Opened::Special);
        }

        // Read without it: FUSE may answer EAGAIN to a read that would wait.
        fcntl::fcntl(&fd, fcntl::FcntlArg::F_SETFL(OFlag::empty()))?;

        Ok(Opened::Open((File::from(fd), stat)))
    }

    /// The type of what `stat` describes: `S_IFREG`, `S_IFDIR`, `S_IFLNK`…
    fn kind(stat: &FileStat) -> SFlag {
        SFlag::from_bits_truncate(stat.st_mode) & SFlag::S_IFMT
    }

    /// The permissions `stat` gives, as `0o644`.
    #[allow(
        clippy::useless_conversion,
        reason = "mode_t is u32 on Linux, u16 on macOS"
    )]
    fn mode(stat: &FileStat) -> u32 {
        u32::from(stat.st_mode) & 0o7777
    }

    /// The path of `relative`, for an error.
    fn path_of(&self, relative: &[u8]) -> PathBuf {
        self.root_path.join(OsStr::from_bytes(relative))
    }

    /// The globs of `patterns`: each `folder/**` with `folder` beside it, which picomatch matches with it, and a leading
    /// `./` dropped.
    fn globs(patterns: &[String]) -> Result<GlobSet, BackupError> {
        let mut set = GlobSetBuilder::new();

        for pattern in patterns {
            let refused = |reason: &str| BackupError::InvalidGlob {
                glob: pattern.clone(),
                source: reason.into(),
            };

            if pattern.starts_with('!') {
                return Err(refused(
                    "a negation is not read: list what to leave out in exclude",
                ));
            }

            if Self::EXTGLOBS
                .iter()
                .any(|extglob| pattern.contains(extglob))
            {
                return Err(refused("an extglob is not read"));
            }

            let glob = pattern.strip_prefix("./").unwrap_or(pattern);
            let folder = glob.strip_suffix("/**").filter(|folder| !folder.is_empty());

            for glob in std::iter::once(glob).chain(folder) {
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
    use std::ffi::{CString, OsStr};
    use std::fs;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;
    use std::os::unix::net::UnixListener;
    use std::path::Path;

    use nix::dir::Dir;
    use nix::sys::stat::Mode;
    use tokio_util::sync::CancellationToken;

    use super::{BackupError, BackupFiles, Opened};

    /// `root`, open as a folder.
    fn open(root: &Path) -> Dir {
        Dir::open(root, BackupFiles::FOLDER, Mode::empty()).expect("opened")
    }

    /// The files of `root` that `include` and `exclude` keep, by their relative paths, the links and the special files
    /// left out.
    fn kept(root: &Path, include: &[&str], exclude: &[&str]) -> (Vec<String>, u64, u64) {
        let strings = |globs: &[&str]| {
            globs
                .iter()
                .map(|glob| (*glob).to_owned())
                .collect::<Vec<_>>()
        };
        let mut files = BackupFiles::new(
            open(root),
            root.to_owned(),
            &strings(include),
            &strings(exclude),
        )
        .expect("valid globs");
        let mut kept = Vec::new();

        files
            .walk(&CancellationToken::new(), &mut |file| {
                kept.push(String::from_utf8(file.relative).expect("UTF-8"));
                Ok(())
            })
            .expect("walked");

        (kept, files.skipped_links(), files.skipped_special())
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

    /// `name` as a name of a folder.
    fn name(name: &str) -> CString {
        CString::new(name).expect("a name")
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
        assert_eq!(
            kept(dir.path(), &["./config/**"], &["./config/deep/**"]).0,
            ["config/app.ini", "config/cache/blob"],
            "a leading ./ is dropped"
        );
    }

    #[test]
    fn excludes_a_folder_itself_with_its_globstar_as_picomatch_does() {
        let dir = folder(&["data/keep.txt", "cache/blob", "logs"]);

        symlink("/etc", dir.path().join("media")).expect("linked");

        let (files, skipped, _) = kept(dir.path(), &["**"], &["cache/**", "media/**", "logs/**"]);

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

        let (files, skipped, _) = kept(dir.path(), &["**"], &[]);

        assert_eq!(files, ["data/real.txt"]);
        assert_eq!(skipped, 3);
    }

    #[test]
    fn leaves_out_a_fifo_and_a_socket_without_waiting_on_them() {
        let dir = folder(&["data/real.txt"]);

        nix::unistd::mkfifo(&dir.path().join("data/pipe"), Mode::S_IRWXU).expect("made");

        let _socket = UnixListener::bind(dir.path().join("data/socket")).expect("bound");
        let (files, _, special) = kept(dir.path(), &["**"], &[]);

        assert_eq!(files, ["data/real.txt"]);
        assert_eq!(special, 2);

        // Put in place of a file once the walk saw a regular one: opened without waiting for a writer, then left out.
        let data = open(&dir.path().join("data"));

        assert!(matches!(
            BackupFiles::open_file(&data, &name("pipe")),
            Ok(Opened::Special)
        ));
        assert!(matches!(
            BackupFiles::open_file(&data, &name("socket")),
            Ok(Opened::Special)
        ));
    }

    #[test]
    fn opens_no_folder_or_file_through_a_link_put_in_its_place() {
        let dir = folder(&["data/real.txt"]);
        let outside = folder(&["secret.txt"]);

        // As if the folder and the file were swapped for links once the walk had read what they were.
        symlink(outside.path(), dir.path().join("data/swapped")).expect("linked");
        symlink(
            outside.path().join("secret.txt"),
            dir.path().join("data/file"),
        )
        .expect("linked");

        let data = open(&dir.path().join("data"));

        assert!(matches!(
            BackupFiles::open_folder(&data, &name("swapped")),
            Ok(Opened::Link)
        ));
        assert!(matches!(
            BackupFiles::open_file(&data, &name("file")),
            Ok(Opened::Link)
        ));
        assert!(matches!(
            BackupFiles::open_folder(&data, &name("real.txt")),
            Ok(Opened::Special)
        ));
    }

    #[test]
    fn stops_walking_once_canceled_even_where_no_file_is_kept() {
        let dir = folder(&["a/b/c.txt", "d/e.txt"]);
        let canceled = CancellationToken::new();
        let mut files = BackupFiles::new(
            open(dir.path()),
            dir.path().to_owned(),
            &["*.db".to_owned()],
            &[],
        )
        .expect("valid globs");

        canceled.cancel();

        assert!(files.walk(&canceled, &mut |_| Ok(())).is_err());
    }

    #[test]
    fn reads_a_regular_file_without_o_nonblock() {
        let dir = folder(&["data.db"]);
        let root = open(dir.path());
        let Ok(Opened::Open((file, _))) = BackupFiles::open_file(&root, &name("data.db")) else {
            panic!("a regular file opens");
        };
        let flags = nix::fcntl::fcntl(&file, nix::fcntl::FcntlArg::F_GETFL).expect("its flags");

        assert!(
            !nix::fcntl::OFlag::from_bits_truncate(flags).contains(nix::fcntl::OFlag::O_NONBLOCK)
        );
    }

    #[test]
    fn gives_a_name_that_is_not_utf8_as_its_bytes() {
        let dir = folder(&[]);
        let bytes = [b'a', 0xff, b'.', b't', b'x', b't'];

        fs::write(dir.path().join(OsStr::from_bytes(&bytes)), "x").expect("written");

        let mut files = BackupFiles::new(
            open(dir.path()),
            dir.path().to_owned(),
            &["**".to_owned()],
            &[],
        )
        .expect("valid globs");
        let mut names = Vec::new();

        files
            .walk(&CancellationToken::new(), &mut |file| {
                names.push(file.relative);
                Ok(())
            })
            .expect("walked");

        assert_eq!(names, [bytes.to_vec()]);
    }

    #[test]
    fn refuses_a_glob_it_cannot_read_or_that_picomatch_reads_another_way() {
        let dir = folder(&[]);

        for glob in ["a[", "!media/**", "+(a|b).txt", "@(a).txt", "data/!(cache)"] {
            let refused = BackupFiles::new(
                open(dir.path()),
                dir.path().to_owned(),
                &[glob.to_owned()],
                &[],
            );

            assert!(
                matches!(&refused, Err(BackupError::InvalidGlob { glob: named, .. }) if named == glob),
                "{glob}"
            );
        }
    }
}
