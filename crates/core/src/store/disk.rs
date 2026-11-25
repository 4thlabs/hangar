//! What the store asks of the file system: whether a path is there, whether a file has content, the symlinks of the
//! installed apps, and files created under a name no one else holds.

use std::io;
use std::path::{Component, Path, PathBuf};

/// The file system, as the store reads and links it.
pub(crate) struct Disk;

impl Disk {
    /// Whether `path` is there, its symlinks followed, as the Waku version's `Runtime.exists`: a dangling link is not.
    /// A failure other than "not there", such as a permission error, is logged, so that it does not pass silently for
    /// a missing path.
    pub(crate) async fn exists(path: &Path) -> bool {
        match tokio::fs::metadata(path).await {
            Ok(_) => true,
            Err(error) => {
                if !Self::is_missing(&error) {
                    tracing::warn!(path = %path.display(), %error, "could not check whether a path exists");
                }

                false
            }
        }
    }

    /// Whether `path` is a folder, its links followed; not when it cannot be read, which is logged unless it is not
    /// there.
    pub(crate) async fn is_folder(path: &Path) -> bool {
        match tokio::fs::metadata(path).await {
            Ok(metadata) => metadata.is_dir(),
            Err(error) => {
                if !Self::is_missing(&error) {
                    tracing::warn!(path = %path.display(), %error, "could not check whether a path is a folder");
                }

                false
            }
        }
    }

    /// Whether `file` holds anything but blanks: a fresh empty `compose.swarm.yml`, as the editor creates it, does not
    /// make an app able to run in the swarm yet. A file that cannot be read has none; a failure other than "not
    /// there" is logged.
    pub(crate) async fn has_content(file: &Path) -> bool {
        match tokio::fs::read(file).await {
            Ok(bytes) => !String::from_utf8_lossy(&bytes).trim().is_empty(),
            Err(error) => {
                if !Self::is_missing(&error) {
                    tracing::warn!(path = %file.display(), %error, "could not read a file of the store");
                }

                false
            }
        }
    }

    /// Whether `name` is a single entry of a folder: not empty, `.` or `..`, not absolute, without a separator, so
    /// that joined to a folder it stays in it.
    pub(crate) fn is_entry_name(name: &str) -> bool {
        let mut components = Path::new(name).components();
        let is_single = matches!(
            (components.next(), components.next()),
            (Some(Component::Normal(entry)), None) if entry == name
        );

        is_single && !name.contains(['/', '\\'])
    }

    /// Whether `left` and `right` lead to the same file, their links followed; not when either cannot be resolved.
    pub(crate) async fn is_same(left: &Path, right: &Path) -> bool {
        let (left, right) = tokio::join!(
            tokio::fs::canonicalize(left),
            tokio::fs::canonicalize(right)
        );

        matches!((left, right), (Ok(left), Ok(right)) if left == right)
    }

    /// Whether `error` says that a path is not there: it, or one of its folders.
    pub(crate) fn is_missing(error: &io::Error) -> bool {
        matches!(
            error.kind(),
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
        )
    }

    /// Creates a file that did not exist, named by `name` from the attempt, from 1: the first name that no file holds
    /// yet. A link planted under that name is not written through.
    pub(crate) async fn create_new(
        name: impl Fn(u32) -> PathBuf,
    ) -> io::Result<(tokio::fs::File, PathBuf)> {
        /// How many names are tried before giving up: more files of one name in one millisecond are not expected.
        const ATTEMPTS: u32 = 1000;

        for attempt in 1..=ATTEMPTS {
            let path = name(attempt);
            let created = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .await;

            match created {
                Ok(file) => return Ok((file, path)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
        }

        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "every name tried is taken",
        ))
    }

    /// Links `destination` to `source`, by its absolute path, as the Waku version does: a symlink.
    #[cfg(unix)]
    pub(crate) async fn link(source: &Path, destination: &Path) -> io::Result<()> {
        tokio::fs::symlink(source, destination).await
    }

    /// Links `destination` to `source` with a symlink to a folder or to a file, as `source` is. It takes the developer
    /// mode or the privilege to create symlinks, and fails without them, rather than linking another way, such as a
    /// junction, that the Waku version would not read the same.
    #[cfg(windows)]
    pub(crate) async fn link(source: &Path, destination: &Path) -> io::Result<()> {
        if tokio::fs::metadata(source).await?.is_dir() {
            tokio::fs::symlink_dir(source, destination).await
        } else {
            tokio::fs::symlink_file(source, destination).await
        }
    }

    /// Fails: this platform has no symlinks, and the installed apps are symlinks.
    #[cfg(not(any(unix, windows)))]
    pub(crate) async fn link(_source: &Path, _destination: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this platform has no symlinks",
        ))
    }

    /// Removes the link at `destination`, not what it points to.
    pub(crate) async fn unlink(destination: &Path) -> io::Result<()> {
        // Windows removes a symlink to a folder as a folder.
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileTypeExt;

            if tokio::fs::symlink_metadata(destination)
                .await?
                .file_type()
                .is_symlink_dir()
            {
                return tokio::fs::remove_dir(destination).await;
            }
        }

        tokio::fs::remove_file(destination).await
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::Disk;

    #[tokio::test]
    async fn follows_a_link_to_tell_whether_a_path_exists() {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let target = dir.path().join("target");
        let link = dir.path().join("link");

        Disk::link(&target, &link)
            .await
            .expect("a dangling link can be made");

        assert!(!Disk::exists(&link).await, "a dangling link is not there");

        std::fs::create_dir(&target).expect("the target can be made");

        assert!(Disk::exists(&link).await);

        Disk::unlink(&link).await.expect("the link can be removed");

        assert!(!Disk::exists(&link).await);
        assert!(Disk::exists(&target).await, "the target stays");
    }

    #[test]
    fn takes_a_single_entry_for_an_entry_name_and_nothing_that_leaves_its_folder() {
        for name in ["jellyfin", "networks.yml", ".env.shared", "a..b"] {
            assert!(Disk::is_entry_name(name), "{name}");
        }

        for name in [
            "",
            ".",
            "..",
            "../app-data",
            "a/b",
            "a/",
            "/etc",
            "./a",
            "a\\b",
        ] {
            assert!(!Disk::is_entry_name(name), "{name:?}");
        }
    }

    #[tokio::test]
    async fn creates_a_file_under_the_first_name_no_file_holds() {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let name = |attempt: u32| dir.path().join(format!("file-{attempt}"));

        std::fs::write(name(1), "taken").expect("the file can be written");

        let (_, created) = Disk::create_new(name).await.expect("a name is free");

        assert_eq!(created, dir.path().join("file-2"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("file-1")).expect("the file reads"),
            "taken"
        );
    }

    #[tokio::test]
    async fn takes_a_blank_or_missing_file_for_one_without_content() {
        let dir = tempfile::tempdir().expect("a temporary directory can be made");
        let file = dir.path().join("compose.swarm.yml");

        assert!(!Disk::has_content(&file).await);

        std::fs::write(&file, " \n\t\n").expect("the file can be written");

        assert!(!Disk::has_content(&file).await);

        std::fs::write(&file, "services: {}\n").expect("the file can be written");

        assert!(Disk::has_content(&file).await);
    }
}
