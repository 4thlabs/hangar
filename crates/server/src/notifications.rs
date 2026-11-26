//! What the server tells its users of an outcome they did not wait for, as the end of a store sync: one list for every
//! user, as there are no roles, the last 100 kept in a JSON file of the data directory, and pushed to the pages that
//! follow it as they are filed, in process.
//!
//! A notification says what it says as a key and its params, which the page words. A page shows a new one as a toast
//! once, which marks it seen for every page, and its list counts it unread until a user reads the list, which marks
//! every one read.

mod file;
mod list;
mod routes;

use std::sync::{Arc, Mutex, MutexGuard};

use futures::{Stream, StreamExt, stream};
use hangar_api::{NotificationLevel, NotificationMessage};
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
    pub(crate) fn load(data_dir: &DataDir) -> Self {
        let file = NotificationFile::new(data_dir);
        let list = file.read();

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

    /// The newest notifications a page reads at first, the newest first.
    pub(crate) fn newest(&self) -> Vec<hangar_api::Notification> {
        self.lock().newest(Self::PAGE)
    }

    /// The notifications filed from now on, and first, given `since`, those kept of a greater id, the oldest first.
    /// A page that falls too far behind gets those it missed from the list.
    pub(crate) fn follow(
        &self,
        since: Option<u64>,
    ) -> impl Stream<Item = hangar_api::Notification> + Send + 'static {
        // Subscribed under the lock, which filing takes too: none is filed between the backlog and the subscription.
        let (backlog, filed) = {
            let list = self.lock();
            let backlog = since.map(|id| list.after(id)).unwrap_or_default();

            (backlog, self.0.filed.subscribe())
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

        stream::iter(backlog).chain(live)
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
    use futures::StreamExt;
    use hangar_api::{NotificationLevel, NotificationMessage};
    use hangar_core::DataDir;

    use super::{Notification, Notifier};

    fn notifier(dir: &tempfile::TempDir) -> Notifier {
        Notifier::load(&DataDir::new(dir.path()).expect("a data directory"))
    }

    fn updated() -> Notification {
        Notification {
            level: NotificationLevel::Success,
            message: NotificationMessage::StoreUpdated,
            href: Some("/settings".to_owned()),
            dedupe_key: None,
        }
    }

    fn ids(notifications: &[hangar_api::Notification]) -> Vec<u64> {
        notifications
            .iter()
            .map(|notification| notification.id)
            .collect()
    }

    #[tokio::test]
    async fn a_notification_is_saved_and_read_back_by_the_next_server() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir);

        notifier.notify(updated());
        notifier.notify(updated());
        notifier.mark_seen(&[1]);
        notifier.mark_read();
        notifier.saved().await;

        let next = self::notifier(&dir);

        assert_eq!(next.newest(), notifier.newest());
        assert_eq!(
            next.newest()
                .iter()
                .map(|notification| (notification.id, notification.seen, notification.read))
                .collect::<Vec<_>>(),
            [(2, false, true), (1, true, true)]
        );
    }

    #[tokio::test]
    async fn follows_from_since_then_each_one_filed_once() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir);

        for _ in 0..3 {
            notifier.notify(updated());
        }

        let mut followed = Box::pin(notifier.follow(Some(1)));
        let mut from_now = Box::pin(notifier.follow(None));

        notifier.notify(updated());

        let mut ids = Vec::new();

        for _ in 0..3 {
            ids.push(followed.next().await.expect("a notification").id);
        }

        assert_eq!(ids, [2, 3, 4]);
        assert_eq!(
            from_now.next().await.map(|notification| notification.id),
            Some(4)
        );
    }

    #[tokio::test]
    async fn a_page_that_falls_behind_gets_those_it_missed_from_the_list() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let notifier = notifier(&dir);
        let mut followed = Box::pin(notifier.follow(None));

        for _ in 0..Notifier::BACKLOG + 10 {
            notifier.notify(updated());
        }

        let mut received = Vec::new();

        while received.len() < Notifier::BACKLOG + 10 {
            received.push(followed.next().await.expect("a notification"));
        }

        let expected: Vec<u64> =
            (1..=u64::try_from(Notifier::BACKLOG + 10).expect("small")).collect();

        assert_eq!(ids(&received), expected, "every one, once, in order");
    }
}
