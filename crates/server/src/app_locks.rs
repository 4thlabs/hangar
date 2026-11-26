//! The installed apps that a command holds: a compose batch over them, or an install or an uninstall of one, so that
//! two never run on one app at once. An uninstall's `down` then its unlink, with an `up` of a batch between them,
//! would leave a stack running that no installed app manages.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError};

use hangar_api::ErrorCode;

/// The apps held, each by one command at a time. Shared by the store and compose: `App` holds it in an `Arc`.
#[derive(Debug, Default)]
pub(crate) struct AppLocks {
    held: Mutex<HashSet<String>>,
}

/// The apps a command holds, until it is dropped.
#[derive(Debug)]
pub(crate) struct AppClaim {
    locks: Arc<AppLocks>,
    apps: Vec<String>,
}

impl AppLocks {
    /// Holds each of `apps` for one command, all of them or none: a command holds its apps whole.
    ///
    /// # Errors
    ///
    /// A 409, `compose.app_busy`, naming the first app another command holds; none is held then.
    pub(crate) fn claim<'a>(
        self: &Arc<Self>,
        apps: impl IntoIterator<Item = &'a str>,
    ) -> Result<AppClaim, ErrorCode> {
        let mut held = self.held();
        let mut apps: Vec<String> = apps.into_iter().map(str::to_owned).collect();

        apps.sort();
        apps.dedup();

        if let Some(busy) = apps.iter().find(|app| held.contains(app.as_str())) {
            tracing::warn!(app = %busy, "a command was refused: another holds its app");

            return Err(ErrorCode::AppBusy { app: busy.clone() });
        }

        held.extend(apps.iter().cloned());

        Ok(AppClaim {
            locks: Arc::clone(self),
            apps,
        })
    }

    /// The apps held, whatever a panic left them: each claim and release is written whole.
    fn held(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Drop for AppClaim {
    fn drop(&mut self) {
        let mut held = self.locks.held();

        for app in &self.apps {
            held.remove(app);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use hangar_api::ErrorCode;

    use super::AppLocks;

    #[test]
    fn holds_an_app_for_one_command_at_a_time_and_all_its_apps_or_none() {
        let locks = Arc::new(AppLocks::default());
        let batch = locks.claim(["alpha", "beta"]).expect("nothing is held");

        assert_eq!(
            locks.claim(["gamma", "beta"]).expect_err("beta is held"),
            ErrorCode::AppBusy {
                app: "beta".to_owned()
            }
        );
        assert!(
            locks.claim(["gamma"]).is_ok(),
            "the refused claim held nothing"
        );

        drop(batch);

        assert!(locks.claim(["alpha", "beta"]).is_ok(), "released");
    }
}
