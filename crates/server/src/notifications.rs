//! What the server tells its users of an outcome they did not wait for, as the end of a store sync: one list for every
//! user, as there are no roles, the last 100 kept in a JSON file of the data directory, and pushed to the pages that
//! follow it as they are filed, in process.
//!
//! A notification says what it says as a key and its params, which the page words. Each page open shows a new one as a
//! toast, which marks it seen, so that a page opened after does not; its list counts it unread until a user reads the
//! list, which marks every one read, for everyone. Its id grows within an epoch, drawn anew each time the ids start
//! again from 1, as when the file was lost: a page that holds ids of another epoch is given every notification kept.

mod file;
mod list;
mod routes;

use std::sync::{Arc, Mutex, MutexGuard};

use futures::{Stream, StreamExt, stream};
use hangar_api::{NotificationEvent, NotificationLevel, NotificationMessage, RecentNotifications};
use hangar_core::DataDir;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::{broadcast, watch};

use file::NotificationFile;
use list::NotificationList;

/// A notification to file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Notification {
    /// How it reads.
    pub(crate) level: NotificationLevel,
    /// What it says.
    pub(crate) message: NotificationMessage,
    /// The page it leads to, as `/settings`.
    pub(crate) href: Option<String>,
    /// What it is about, as `backup:alpha`: it replaces the notification filed before it of the same key.
    pub(crate) dedupe_key: Option<String>,
}

/// Where the server files its notifications, and the pages read them. Its clones share the list.
#[derive(Debug, Clone)]
pub(crate) struct Notifier(Arc<Shared>);

#[derive(Debug)]
struct Shared {
    list: Mutex<NotificationList>,
    file: NotificationFile,
    /// Each notification filed, for the pages that follow them; sent under the list's lock, so in the order of the ids.
    filed: broadcast::Sender<hangar_api::Notification>,
    /// One save at a time, each of the list as it is then: the last one writes the last change.
    saving: tokio::sync::Mutex<()>,
    /// The version of the list in the file.
    saved: watch::Sender<u64>,
}

impl Notifier {
    /// How many notifications a page reads at first.
    const PAGE: usize = 30;

    /// How many notifications a page that reads slowly may fall behind before it reads them from the list again.
    const BACKLOG: usize = 64;

    /// The notifications of `data_dir`, read from its file once, as the server starts.
    pub(crate) async fn load(data_dir: &DataDir) -> Self {
        let file = NotificationFile::new(data_dir);
        let list = file.read().await;

        Self(Arc::new(Shared {
            saved: watch::Sender::new(list.version()),
            list: Mutex::new(list),
            file,
            filed: broadcast::channel(Self::BACKLOG).0,
            saving: tokio::sync::Mutex::new(()),
        }))
    }

    /// Files `notification` for every user, pushes it to the pages that follow the notifications, and saves the list
    /// apart from the caller: a notification tells of some other work, which a failure to save it must not fail. That
    /// failure is logged, and the next change saves the list again.
    pub(crate) fn notify(&self, notification: Notification) {
        tracing::info!(
            level = ?notification.level,
            message = ?notification.message,
            href = notification.href,
            "notification"
        );

        {
            let mut list = self.lock();
            let filed = list.file(notification, Self::now());

            // An error says no page follows the notifications, which is no failure.
            let _ = self.0.filed.send(filed);
        }

        self.save();
    }

    /// The newest notifications a page reads at first, the newest first, and the epoch of their ids.
    pub(crate) fn recent(&self) -> RecentNotifications {
        let list = self.lock();

        RecentNotifications {
            epoch: list.epoch().to_owned(),
            notifications: list.newest(Self::PAGE),
        }
    }

    /// The epoch of the ids, then the notifications filed from now on, and first, given `since`, those kept of a
    /// greater id, the oldest first; given an `epoch` that is not the list's, `since` counts in another, and every
    /// one kept comes first. A page that falls too far behind gets those it missed from the list.
    pub(crate) fn follow(
        &self,
        since: Option<u64>,
        epoch: Option<&str>,
    ) -> impl Stream<Item = NotificationEvent> + Send + 'static {
        // Subscribed under the lock, which filing takes too: none is filed between the backlog and the subscription.
        let (opened, since, backlog, filed) = {
            let list = self.lock();
            let since = match epoch {
                Some(epoch) if epoch != list.epoch() => Some(0),
                _ => since,
            };
            let backlog = since.map(|id| list.after(id)).unwrap_or_default();
            let opened = NotificationEvent::Opened {
                epoch: list.epoch().to_owned(),
            };

            (opened, since, backlog, self.0.filed.subscribe())
        };
        let last = backlog
            .last()
            .map_or(since.unwrap_or(0), |notification| notification.id);
        let live = stream::unfold(
            (filed, last, self.clone()),
            |(mut filed, last, notifier)| async move {
                let next = match filed.recv().await {
                    Ok(notification) if notification.id > last => vec![notification],
                    Ok(_) => Vec::new(),
                    Err(RecvError::Lagged(_)) => notifier.lock().after(last),
                    Err(RecvError::Closed) => return None,
                };
                let last = next.last().map_or(last, |notification| notification.id);

                Some((next, (filed, last, notifier)))
            },
        )
        .flat_map(stream::iter);

        stream::once(async { opened }).chain(
            stream::iter(backlog)
                .chain(live)
                .map(|notification| NotificationEvent::Filed { notification }),
        )
    }

    /// Marks the notifications of `ids` as shown, and saves the list if one was not yet.
    pub(crate) fn mark_seen(&self, ids: &[u64]) {
        if self.lock().mark_seen(ids) {
            self.save();
        }
    }

    /// Marks every notification as read, and saves the list if one was not yet.
    pub(crate) fn mark_read(&self) {
        if self.lock().mark_read() {
            self.save();
        }
    }

    /// Saves what is not saved yet, once the saves running have ended: as the server stops, so that a change made just
    /// before is in the file. A failure is logged.
    pub(crate) async fn flush(&self) {
        Arc::clone(&self.0).save().await;
    }

    /// Saves the list, apart from the caller.
    fn save(&self) {
        let shared = Arc::clone(&self.0);

        tokio::spawn(shared.save());
    }

    fn lock(&self) -> MutexGuard<'_, NotificationList> {
        self.0.lock()
    }

    /// Now, in RFC 3339, to the millisecond, as the store's syncs are dated.
    fn now() -> String {
        format!("{:.3}", jiff::Timestamp::now())
    }

    /// Resolves once the file holds the list as it is now.
    #[cfg(test)]
    pub(crate) async fn saved(&self) {
        let version = self.lock().version();
        let mut saved = self.0.saved.subscribe();

        saved
            .wait_for(|saved| *saved >= version)
            .await
            .expect("the notifier holds the sender");
    }
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, NotificationList> {
        self.list
            .lock()
            .expect("no code panics while holding the notifications")
    }

    /// Writes the list to its file, unless the file holds this version of it already, as a save that came after
    /// wrote it.
    async fn save(self: Arc<Self>) {
        let _turn = self.saving.lock().await;
        let (version, contents) = {
            let list = self.lock();

            (list.version(), list.to_json())
        };

        if version <= *self.saved.borrow() {
            return;
        }

        match self.file.write(&contents).await {
            Ok(()) => {
                self.saved.send_replace(version);
            }
            Err(error) => tracing::error!(
                path = %self.file.path().display(),
                %error,
                "the notifications could not be saved: the next change saves them again"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use futures::{Stream, StreamExt};
    use hangar_api::{NotificationEvent, NotificationLevel, NotificationMessage};
    use hangar_core::DataDir;

    use super::{Notification, Notifier};

    async fn notifier(dir: &tempfile::TempDir) -> Notifier {
        Notifier::load(&DataDir::new(dir.path()).expect("a data directory")).await
    }

    fn updated() -> Notification {
        Notification {
            level: NotificationLevel::Success,
            message: NotificationMessage::StoreUpdated,
            href: Some("/settings".to_owned()),
            dedupe_key: None,
        }
    }

    /// The epoch the stream opens with.
    async fn opened(events: &mut (impl Stream<Item = NotificationEvent> + Unpin)) -> String {
        match events.next().await {
            Some(NotificationEvent::Opened { epoch }) => epoch,
            other => panic!("the stream opens with its epoch, not {other:?}"),
        }
    }

    /// The ids of the next `count` notifications of the stream.
    async fn filed(
        events: &mut (impl Stream<Item = NotificationEvent> + Unpin),
        count: usize,
    ) -> Vec<u64> {
        let mut ids = Vec::new();

        while ids.len() < count {
            match events.next().await {
                Some(NotificationEvent::Filed { notification }) => ids.push(notification.id),
                other => panic!("a notification, not {other:?}"),
            }
        }

        ids
    }

    #[tokio::test]
    async fn a_notification_is_saved_and_read_back_by_the_next_server() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir).await;

        notifier.notify(updated());
        notifier.notify(updated());
        notifier.mark_seen(&[1]);
        notifier.mark_read();
        notifier.saved().await;

        let next = self::notifier(&dir).await;

        assert_eq!(next.recent(), notifier.recent());
        assert_eq!(
            next.recent()
                .notifications
                .iter()
                .map(|notification| (notification.id, notification.seen, notification.read))
                .collect::<Vec<_>>(),
            [(2, false, true), (1, true, true)]
        );
    }

    #[tokio::test]
    async fn a_change_made_just_before_the_stop_is_in_the_file_once_flushed() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir).await;

        notifier.notify(updated());
        notifier.mark_read();
        notifier.flush().await;

        assert_eq!(self::notifier(&dir).await.recent(), notifier.recent());
    }

    #[tokio::test]
    async fn follows_from_since_then_each_one_filed_once() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir).await;

        for _ in 0..3 {
            notifier.notify(updated());
        }

        let epoch = notifier.recent().epoch;
        let mut followed = Box::pin(notifier.follow(Some(1), Some(&epoch)));
        let mut from_now = Box::pin(notifier.follow(None, None));

        notifier.notify(updated());

        assert_eq!(opened(&mut followed).await, epoch);
        assert_eq!(filed(&mut followed, 3).await, [2, 3, 4]);
        assert_eq!(opened(&mut from_now).await, epoch);
        assert_eq!(filed(&mut from_now, 1).await, [4]);
    }

    #[tokio::test]
    async fn a_page_of_ids_of_another_epoch_is_given_every_one_kept_after_the_file_was_lost() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let before = notifier(&dir).await;

        for _ in 0..50 {
            before.notify(updated());
        }

        before.flush().await;

        let page = before.recent();

        // The file lost, as one put aside or never saved before a restart: the ids start again from 1.
        std::fs::remove_file(dir.path().join("app-data/hangar/notifications.json"))
            .expect("removed");

        let after = notifier(&dir).await;

        after.notify(updated());

        let mut events = Box::pin(after.follow(Some(50), Some(&page.epoch)));

        assert_ne!(opened(&mut events).await, page.epoch);
        assert_eq!(
            filed(&mut events, 1).await,
            [1],
            "the one filed before it opened"
        );

        after.notify(updated());

        assert_eq!(filed(&mut events, 1).await, [2], "and each new one");
    }

    #[tokio::test]
    async fn a_page_that_falls_behind_gets_those_it_missed_from_the_list() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir).await;
        let mut followed = Box::pin(notifier.follow(None, None));

        for _ in 0..Notifier::BACKLOG + 10 {
            notifier.notify(updated());
        }

        let expected: Vec<u64> =
            (1..=u64::try_from(Notifier::BACKLOG + 10).expect("small")).collect();

        opened(&mut followed).await;

        assert_eq!(
            filed(&mut followed, Notifier::BACKLOG + 10).await,
            expected,
            "every one, once, in order"
        );
    }
}
