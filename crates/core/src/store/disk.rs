//! What the store asks of the file system: whether a path is there, whether a file has content, and the symlinks of
//! the installed apps.

use std::io;
use std::path::Path;

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
                let is_missing = matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                );

                if !is_missing {
                    tracing::warn!(path = %path.display(), %error, "could not check whether a path exists");
                }

                false
            }
        }
    }

    /// Whether `file` holds anything but blanks: a fresh empty `compose.swarm.yml`, as the editor creates it, does not
    /// make an app able to run in the swarm yet. A file that cannot be read has none.
    pub(crate) async fn has_content(file: &Path) -> bool {
        tokio::fs::read(file)
            .await
            .is_ok_and(|bytes| !String::from_utf8_lossy(&bytes).trim().is_empty())
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
