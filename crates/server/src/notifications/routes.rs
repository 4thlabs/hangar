//! The routes of the group `Notifications`: the newest, those filed from a `since`, and the marks of seen and read.

use hangar_api::{Notification, NotificationsServer, SeenNotifications};
use quoll::{Events, Response, Result};

use crate::App;
use crate::auth::SignedIn;

impl NotificationsServer for App {
    async fn list(&self, _: &SignedIn) -> Result<Response<Vec<Notification>>> {
        Ok(Response::new(self.notifier.newest()))
    }

    async fn events(
        &self,
        _: &SignedIn,
        since: Option<u64>,
    ) -> Result<Response<Events<Notification>>> {
        Ok(Response::new(Events::new(self.notifier.follow(since))))
    }

    async fn seen(&self, _: &SignedIn, notifications: SeenNotifications) -> Result<Response<()>> {
        self.notifier.mark_seen(&notifications.ids);

        Ok(Response::new(()))
    }

    async fn read(&self, _: &SignedIn) -> Result<Response<()>> {
        self.notifier.mark_read();

        Ok(Response::new(()))
    }
}
