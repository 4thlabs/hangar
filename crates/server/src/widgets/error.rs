//! Why a widget loaded nothing, which the log says whole and the page as `widgets.unavailable`.

use std::error::Error as StdError;

/// Why a widget's load, or a part of it, gave nothing.
#[derive(Debug, thiserror::Error)]
pub(crate) enum LoadError {
    /// A call to its service failed: no answer, an error, or an answer the widget does not read.
    #[error("could not {action}")]
    Call {
        /// What the call was for, as `read gluetun's public address`.
        action: String,
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
    /// The service answered, but not with what the widget shows, or the widget cannot ask it.
    #[error("{0}")]
    Refused(String),
    /// What the store says of the widget's app could not be read.
    #[error("could not read the {what} of the store")]
    Store {
        /// What was read, as `apps`.
        what: &'static str,
        #[source]
        source: hangar_core::StoreError,
    },
    /// The load panicked: a bug, which the next load may not meet.
    #[error("the load of a {name} panicked")]
    Panicked {
        /// What was loaded, as the cache names it.
        name: &'static str,
    },
}

impl LoadError {
    /// The error of a call that was to `action`, for `map_err`.
    pub(crate) fn call<E>(action: impl Into<String>) -> impl FnOnce(E) -> Self
    where
        E: StdError + Send + Sync + 'static,
    {
        let action = action.into();

        move |source| Self::Call {
            action,
            source: Box::new(source),
        }
    }

    /// The error of a service whose answer the widget cannot show, or of a widget that cannot ask it.
    pub(crate) fn refused(reason: impl Into<String>) -> Self {
        Self::Refused(reason.into())
    }
}
