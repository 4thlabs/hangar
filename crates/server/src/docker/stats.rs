//! The stats of the installed apps alone: the daemon's frames cover every compose project of the host, of which only
//! Hangar's are the page's to see, as for the logs and a project's detail.

use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;

use futures::{Stream, StreamExt, stream};
use hangar_api::{DockerChange, StatsFrame};
use hangar_core::DockerError;
use tokio::sync::broadcast::{self, error::TryRecvError};

use super::DockerState;
use super::views::Views;

/// The frames of the daemon, as the core samples them.
type Frames = Pin<Box<dyn Stream<Item = Result<hangar_core::StatsFrame, DockerError>> + Send>>;

/// Where a stream of the installed apps' stats is.
pub(super) struct InstalledStats {
    state: Arc<DockerState>,
    frames: Frames,
    /// What changed since the last frame, which says when the installed containers are to be read again.
    changes: broadcast::Receiver<DockerChange>,
    /// The ids of the containers of the installed apps.
    installed: HashSet<String>,
}

impl InstalledStats {
    /// The frames of `frames` that `state` lets the page see: the containers of the installed apps, read now, and
    /// again on each change of the containers.
    ///
    /// # Errors
    ///
    /// The errors of reading the containers and the installed apps.
    pub(super) async fn follow(
        state: &Arc<DockerState>,
        frames: impl Stream<Item = Result<hangar_core::StatsFrame, DockerError>> + Send + 'static,
    ) -> quoll::Result<impl Stream<Item = quoll::Result<StatsFrame>> + Send + 'static> {
        // Subscribed first: a change while the containers are read is seen at the next frame.
        let changes = state.subscribe();
        let installed = state.installed_containers().await?;
        let stats = Self {
            state: Arc::clone(state),
            frames: Box::pin(frames),
            changes,
            installed,
        };

        Ok(stream::unfold(stats, Self::next))
    }

    /// The next frame, of the installed containers alone.
    async fn next(mut self) -> Option<(quoll::Result<StatsFrame>, Self)> {
        let frame = self.frames.next().await?;

        if self.has_changed() {
            // A failure is logged where it happens, and the last list kept until the next change.
            if let Ok(installed) = self.state.installed_containers().await {
                self.installed = installed;
            }
        }

        let frame = frame
            .map(|mut frame| {
                frame.retain(|id, _| self.installed.contains(id));

                Views::frame(frame)
            })
            .map_err(|error| DockerState::unavailable(&error));

        Some((frame, self))
    }

    /// Whether the containers changed since the last frame, or too many changes went by to tell.
    fn has_changed(&mut self) -> bool {
        let mut has_changed = false;

        loop {
            match self.changes.try_recv() {
                Ok(DockerChange::Containers) | Err(TryRecvError::Lagged(_)) => has_changed = true,
                Ok(DockerChange::Overview) => {}
                Err(TryRecvError::Empty | TryRecvError::Closed) => return has_changed,
            }
        }
    }
}
