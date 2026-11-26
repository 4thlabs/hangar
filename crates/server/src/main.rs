//! `hangar-server`: Hangar's server. It reads its settings from the environment, stops at once when one is missing or
//! bad, and serves its API and its page on port 3010 until Ctrl-C or `SIGTERM`.

use std::process::ExitCode;

use hangar_core::Environment;
use hangar_server::{App, Settings};

/// Where the server listens: the port of the Waku version, which the image publishes.
const ADDRESS: &str = "0.0.0.0:3010";

fn main() -> ExitCode {
    tracing_subscriber::fmt().with_target(false).init();

    let environment = match Environment::load() {
        Ok(environment) => environment,
        Err(error) => {
            tracing::error!("could not read .env: {error}");
            return ExitCode::FAILURE;
        }
    };
    let settings = match Settings::from_environment(&environment) {
        Ok(settings) => settings,
        Err(error) => {
            tracing::error!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let tokio = match tokio::runtime::Runtime::new() {
        Ok(tokio) => tokio,
        Err(error) => {
            tracing::error!("could not start: {error}");
            return ExitCode::FAILURE;
        }
    };

    tokio.block_on(serve(&settings))
}

/// Serves until told to stop.
async fn serve(settings: &Settings) -> ExitCode {
    match &settings.page {
        Some(page) => tracing::info!(
            "serving the page of {} and the API on {ADDRESS}",
            page.display()
        ),
        None => tracing::info!(
            "serving the API on {ADDRESS}, without a page: HANGAR_PAGE_DIR is not set"
        ),
    }

    let served = hangar_server::server(settings)
        .serve(ADDRESS, hangar_server::router(App))
        .await;

    match served {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("could not serve on {ADDRESS}: {error}");
            ExitCode::FAILURE
        }
    }
}
