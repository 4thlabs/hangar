//! The list of notifications as the server keeps it: the newest first, the last 100, each with its dedupe key, and the
//! JSON of its file.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::Notification;

/// The notifications kept, the newest first, and the id of the next one. Each change counts a version, which tells
/// what is saved from what is not yet.
#[derive(Debug, Default)]
pub(super) struct NotificationList {
    kept: VecDeque<Kept>,
    next_id: u64,
    version: u64,
}

/// A notification kept: what the page reads of it, and the key that a newer one of the same replaces it by.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kept {
    #[serde(flatten)]
    notification: hangar_api::Notification,
    dedupe_key: Option<String>,
}

/// The file of the list, as it is written.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Written<'a> {
    next_id: u64,
    notifications: &'a VecDeque<Kept>,
}

/// The file of the list, as it is read: each notification apart, so that one another version wrote, of a key this one
/// does not know, is passed over rather than lose the others.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Read {
    next_id: u64,
    notifications: Vec<Value>,
}

impl NotificationList {
    /// How many notifications are kept: an older one goes as a new one is filed.
    pub(super) const KEPT: usize = 100;

    /// The list that `json`, its file, holds.
    ///
    /// # Errors
    ///
    /// The error of a file that is not the JSON of a list. A notification of the list that is not one this version
    /// reads, as one of a key it does not know, is passed over, and logged.
    pub(super) fn from_json(json: &str) -> serde_json::Result<Self> {
        let read: Read = serde_json::from_str(json)?;
        // Past every id of the file, those passed over included, which a page may hold: ids only grow, or it would
        // miss the next ones. A file edited by hand may hold one past its `nextId`.
        let next_id = read
            .notifications
            .iter()
            .filter_map(|notification| notification.get("id").and_then(Value::as_u64))
            .map(|id| id.saturating_add(1))
            .fold(read.next_id.max(1), u64::max);
        let mut kept: VecDeque<Kept> = read
            .notifications
            .into_iter()
            .filter_map(|notification| match serde_json::from_value(notification) {
                Ok(kept) => Some(kept),
                Err(error) => {
                    tracing::warn!(%error, "a notification of the file is not one this version reads: passed over");
                    None
                }
            })
            .collect();

        kept.truncate(Self::KEPT);

        Ok(Self {
            kept,
            next_id,
            version: 0,
        })
    }

    /// The JSON of its file.
    pub(super) fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec_pretty(&Written {
            next_id: self.next_id(),
            notifications: &self.kept,
        })
        .expect("a notification holds strings, numbers and booleans, which JSON writes")
    }

    /// The version of the list, counted by each change since it was read.
    pub(super) fn version(&self) -> u64 {
        self.version
    }

    /// Files `notification` first, filed at `created_at`, in place of the one of its dedupe key, and lets the oldest
    /// go past [`KEPT`](Self::KEPT); and answers it as the page reads it.
    pub(super) fn file(
        &mut self,
        notification: Notification,
        created_at: String,
    ) -> hangar_api::Notification {
        let id = self.next_id();
        let filed = hangar_api::Notification {
            id,
            level: notification.level,
            message: notification.message,
            href: notification.href,
            seen: false,
            read: false,
            created_at,
        };

        // Removed rather than updated, so that one filed again, its words changed, comes first rather than where the
        // older one was.
        if let Some(key) = &notification.dedupe_key {
            self.kept
                .retain(|kept| kept.dedupe_key.as_ref() != Some(key));
        }

        self.kept.push_front(Kept {
            notification: filed.clone(),
            dedupe_key: notification.dedupe_key,
        });
        self.kept.truncate(Self::KEPT);
        self.next_id = id + 1;
        self.version += 1;

        filed
    }

    /// The newest `count`, the newest first.
    pub(super) fn newest(&self, count: usize) -> Vec<hangar_api::Notification> {
        self.kept
            .iter()
            .take(count)
            .map(|kept| kept.notification.clone())
            .collect()
    }

    /// Those of an id greater than `id`, the oldest first.
    pub(super) fn after(&self, id: u64) -> Vec<hangar_api::Notification> {
        self.kept
            .iter()
            .rev()
            .filter(|kept| kept.notification.id > id)
            .map(|kept| kept.notification.clone())
            .collect()
    }

    /// Marks those of `ids` as shown; whether one was not yet.
    pub(super) fn mark_seen(&mut self, ids: &[u64]) -> bool {
        self.mark(|notification| {
            let is_marked = ids.contains(&notification.id) && !notification.seen;

            notification.seen |= is_marked;

            is_marked
        })
    }

    /// Marks every one as read; whether one was not yet.
    pub(super) fn mark_read(&mut self) -> bool {
        self.mark(|notification| {
            let is_marked = !notification.read;

            notification.read = true;

            is_marked
        })
    }

    /// Calls `mark` on each notification, which answers whether it changed it, and counts a version if one did.
    fn mark(&mut self, mut mark: impl FnMut(&mut hangar_api::Notification) -> bool) -> bool {
        let changed = self.kept.iter_mut().fold(false, |changed, kept| {
            mark(&mut kept.notification) | changed
        });

        if changed {
            self.version += 1;
        }

        changed
    }

    /// The id of the next notification, from 1.
    fn next_id(&self) -> u64 {
        self.next_id.max(1)
    }
}

#[cfg(test)]
mod tests {
    use hangar_api::{NotificationLevel, NotificationMessage};
    use serde_json::json;

    use super::NotificationList;
    use crate::notifications::Notification;

    fn notification(message: NotificationMessage, dedupe_key: Option<&str>) -> Notification {
        Notification {
            level: NotificationLevel::Success,
            message,
            href: Some("/settings".to_owned()),
            dedupe_key: dedupe_key.map(str::to_owned),
        }
    }

    fn messages(list: &NotificationList) -> Vec<(u64, NotificationMessage)> {
        list.newest(NotificationList::KEPT)
            .into_iter()
            .map(|notification| (notification.id, notification.message))
            .collect()
    }

    #[test]
    fn files_the_newest_first_with_ids_from_1() {
        let mut list = NotificationList::default();

        let first = list.file(
            notification(NotificationMessage::StoreInstalled, None),
            "2026-11-26T10:00:00.000Z".to_owned(),
        );

        list.file(
            notification(NotificationMessage::StoreUpdated, None),
            "2026-11-26T10:01:00.000Z".to_owned(),
        );

        assert_eq!(first.id, 1);
        assert!(!first.seen && !first.read);
        assert_eq!(first.created_at, "2026-11-26T10:00:00.000Z");
        assert_eq!(
            messages(&list),
            [
                (2, NotificationMessage::StoreUpdated),
                (1, NotificationMessage::StoreInstalled)
            ]
        );
        assert_eq!(list.version(), 2);
    }

    #[test]
    fn a_notification_of_a_dedupe_key_replaces_the_older_one_and_comes_first() {
        let mut list = NotificationList::default();

        list.file(
            notification(NotificationMessage::StoreInstallFailed, Some("store")),
            String::new(),
        );
        list.file(
            notification(NotificationMessage::StoreInstalled, None),
            String::new(),
        );
        list.file(
            notification(NotificationMessage::StoreUpdateFailed, Some("store")),
            String::new(),
        );

        assert_eq!(
            messages(&list),
            [
                (3, NotificationMessage::StoreUpdateFailed),
                (2, NotificationMessage::StoreInstalled)
            ]
        );
    }

    #[test]
    fn keeps_the_last_100() {
        let mut list = NotificationList::default();

        for _ in 0..105 {
            list.file(
                notification(NotificationMessage::StoreUpdated, None),
                String::new(),
            );
        }

        let kept = list.newest(usize::MAX);

        assert_eq!(kept.len(), 100);
        assert_eq!(kept.first().map(|kept| kept.id), Some(105));
        assert_eq!(kept.last().map(|kept| kept.id), Some(6));
    }

    #[test]
    fn gives_those_after_an_id_the_oldest_first() {
        let mut list = NotificationList::default();

        for _ in 0..4 {
            list.file(
                notification(NotificationMessage::StoreUpdated, None),
                String::new(),
            );
        }

        let ids = |after: u64| -> Vec<u64> {
            list.after(after)
                .iter()
                .map(|notification| notification.id)
                .collect()
        };

        assert_eq!(ids(2), [3, 4]);
        assert_eq!(ids(4), Vec::<u64>::new());
        assert_eq!(ids(0), [1, 2, 3, 4]);
    }

    #[test]
    fn marks_those_shown_seen_and_all_read_counting_a_version_only_for_a_change() {
        let mut list = NotificationList::default();

        for _ in 0..3 {
            list.file(
                notification(NotificationMessage::StoreUpdated, None),
                String::new(),
            );
        }

        assert!(list.mark_seen(&[1, 3, 42]));
        assert!(!list.mark_seen(&[1]), "already seen");
        assert!(list.mark_read());
        assert!(!list.mark_read(), "already read");
        assert_eq!(list.version(), 5);
        assert_eq!(
            list.newest(3)
                .iter()
                .map(|notification| (notification.id, notification.seen, notification.read))
                .collect::<Vec<_>>(),
            [(3, true, true), (2, false, true), (1, true, true)]
        );
    }

    #[test]
    fn reads_back_what_it_writes_and_files_on_from_its_next_id() {
        let mut list = NotificationList::default();

        list.file(
            notification(NotificationMessage::StoreInstalled, Some("store")),
            "2026-11-26T10:00:00.000Z".to_owned(),
        );
        list.mark_seen(&[1]);

        let json = String::from_utf8(list.to_json()).expect("UTF-8");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).expect("JSON"),
            json!({
                "nextId": 2,
                "notifications": [{
                    "id": 1,
                    "level": "success",
                    "message": { "key": "storeInstalled" },
                    "href": "/settings",
                    "seen": true,
                    "read": false,
                    "createdAt": "2026-11-26T10:00:00.000Z",
                    "dedupeKey": "store"
                }]
            })
        );

        let mut read = NotificationList::from_json(&json).expect("a list");

        assert_eq!(read.newest(1), list.newest(1));
        assert_eq!(read.version(), 0);

        read.file(
            notification(NotificationMessage::StoreUpdated, Some("store")),
            String::new(),
        );

        assert_eq!(
            messages(&read),
            [(2, NotificationMessage::StoreUpdated)],
            "its dedupe key is read back"
        );
    }

    #[test]
    fn passes_over_a_notification_it_does_not_read_and_never_gives_an_id_twice() {
        let json = json!({
            "nextId": 3,
            "notifications": [
                { "id": 7, "level": "info", "message": { "key": "fromANewerVersion", "params": { "count": 2 } },
                  "href": null, "seen": false, "read": false, "createdAt": "2026-11-26T10:00:00.000Z" },
                { "id": 2, "level": "error", "message": { "key": "storeUpdateFailed" },
                  "href": "/settings", "seen": false, "read": false, "createdAt": "2026-11-26T09:00:00.000Z" }
            ]
        });

        let mut list = NotificationList::from_json(&json.to_string()).expect("a list");

        assert_eq!(
            messages(&list),
            [(2, NotificationMessage::StoreUpdateFailed)]
        );
        assert_eq!(
            list.file(
                notification(NotificationMessage::StoreUpdated, None),
                String::new()
            )
            .id,
            8,
            "past the id of the one passed over, which a page may hold"
        );
    }

    #[test]
    fn a_file_that_is_not_a_list_is_an_error() {
        assert!(NotificationList::from_json("{ \"notifications\": ").is_err());
        assert!(NotificationList::from_json("[]").is_err());
    }
}
