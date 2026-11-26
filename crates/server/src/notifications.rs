//! What the server tells its users of an outcome they did not wait for, as the end of a store sync: one seam, the
//! notifications' to keep and push, which logs each one until they are kept.

/// How a notification reads: a success, or a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Level {
    /// What was asked for is done.
    Success,
    /// What was asked for failed.
    Error,
}

/// A notification's message, by its key: the Waku version's, in `notification-params.ts`, rendered where it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[expect(
    clippy::enum_variant_names,
    reason = "the keys of the Waku version, to which the other areas add theirs"
)]
pub(crate) enum Message {
    /// The store was cloned.
    StoreInstalled,
    /// The store was pulled.
    StoreUpdated,
    /// The store's clone failed.
    StoreInstallFailed,
    /// The store's pull failed.
    StoreUpdateFailed,
}

impl Message {
    /// The key of the message.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::StoreInstalled => "storeInstalled",
            Self::StoreUpdated => "storeUpdated",
            Self::StoreInstallFailed => "storeInstallFailed",
            Self::StoreUpdateFailed => "storeUpdateFailed",
        }
    }
}

/// A notification for every user: there is one list, as there are no roles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Notification {
    /// How it reads.
    pub(crate) level: Level,
    /// What it says.
    pub(crate) message: Message,
    /// The page it leads to.
    pub(crate) href: &'static str,
}

/// Where the server sends its notifications.
#[derive(Debug, Default)]
pub(crate) struct Notifier {
    /// What was sent, for a test to read.
    #[cfg(test)]
    sent: std::sync::Mutex<Vec<Notification>>,
}

impl Notifier {
    /// Sends `notification` to every user.
    pub(crate) fn notify(&self, notification: Notification) {
        tracing::info!(
            level = ?notification.level,
            message = notification.message.key(),
            href = notification.href,
            "notification"
        );

        #[cfg(test)]
        self.sent
            .lock()
            .expect("no test panics while holding the notifications")
            .push(notification);
    }

    /// What was sent, in order.
    #[cfg(test)]
    pub(crate) fn sent(&self) -> Vec<Notification> {
        self.sent
            .lock()
            .expect("no test panics while holding the notifications")
            .clone()
    }
}
