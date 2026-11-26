//! The notifications: what the server tells its users of an outcome they did not wait for, as the end of a store sync.
//! One list for every user, as there are no roles: its newest, the new ones as they are filed, and whether they were
//! shown and read. A notification says what it says as a key and its params, which the page words.

use quoll::Events;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// How a notification reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationLevel {
    /// What was asked for is done.
    Success,
    /// What was asked for failed.
    Error,
    /// Something wants a look, as an update available.
    Warning,
    /// News.
    Info,
}

/// What a notification says: its key, as `storeInstalled`, and its params, which the page words. It is filed in no
/// language, as an error's code is, so that a catalog can word it in another later. The keys are the Waku version's,
/// each area adding its own:
///
/// ```
/// use hangar_api::NotificationMessage;
///
/// assert_eq!(
///     serde_json::to_value(NotificationMessage::StoreInstalled).expect("JSON"),
///     serde_json::json!({ "key": "storeInstalled" })
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "key", content = "params", rename_all = "camelCase")]
#[non_exhaustive]
pub enum NotificationMessage {
    /// The store was cloned.
    StoreInstalled,
    /// The store was pulled.
    StoreUpdated,
    /// The store's clone failed: why is in the server's log, and in the store's last sync.
    StoreInstallFailed,
    /// The store's pull failed: why is in the server's log, and in the store's last sync.
    StoreUpdateFailed,
}

/// A notification, as the page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    /// Its id, from 1, greater than that of every notification filed before it: what a stream is followed from.
    pub id: u64,
    /// How it reads.
    pub level: NotificationLevel,
    /// What it says.
    pub message: NotificationMessage,
    /// The page it leads to, as `/settings`; `None` for none.
    pub href: Option<String>,
    /// What it is about, as `backup:alpha`: a newer notification of the same key replaces it, on the server and in a
    /// page that holds it. `None` for one that nothing replaces.
    pub dedupe_key: Option<String>,
    /// Whether a page has shown it already, as a toast: a page opened after does not show it again so. The pages open
    /// when it is filed each show it.
    pub seen: bool,
    /// Whether a user has read it, in the list: it no longer counts as unread.
    pub read: bool,
    /// When it was filed, in RFC 3339.
    pub created_at: String,
}

/// The newest notifications, and the epoch of their ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RecentNotifications {
    /// What the ids count in: a random id, new each time they start again from 1, as when the server's file was lost.
    /// A page that holds ids of another epoch holds none of this one's.
    pub epoch: String,
    /// The newest 30, the newest first.
    pub notifications: Vec<Notification>,
}

/// An event of the notifications' stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NotificationEvent {
    /// The first event: the epoch of the ids that follow. A page that holds those of another drops them, as the stream
    /// then gives every notification kept.
    Opened {
        /// The epoch of the server's ids.
        epoch: String,
    },
    /// A notification, filed before the stream opened, of an id past its `since`, or since.
    Filed {
        /// The notification.
        notification: Notification,
    },
}

/// The notifications a page has shown, as toasts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SeenNotifications {
    /// Their ids; one the server no longer keeps is passed over.
    pub ids: Vec<u64>,
}

quoll::group! {
    /// The notifications, one list for every user: the server keeps the last 100.
    #[auth(crate::Session)]
    pub group Notifications {
        /// The newest 30, the newest first, and the epoch of their ids.
        GET "/notifications" => list() -> RecentNotifications;

        /// The epoch of the ids, then the notifications filed from now on, as they are, and first, given `since`, those
        /// of a greater id the server still keeps, the oldest first: a page follows the stream from the newest it
        /// holds, so that what was filed between its read of the list and the stream's opening is in it. Given an
        /// `epoch` that is not the server's, `since` counts in another and every notification kept comes first. It
        /// does not end.
        GET "/notifications/events?since={since}&epoch={epoch}"
            => events(since: Option<u64>, epoch: Option<&str>) -> Events<NotificationEvent>;

        /// Marks notifications as shown, so that no page shows them again as toasts.
        POST "/notifications/seen" => seen(notifications: &SeenNotifications);

        /// Marks every notification as read.
        POST "/notifications/read" => read();
    }
}
