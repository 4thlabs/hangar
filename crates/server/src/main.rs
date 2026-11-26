//! `hangar-server`: Hangar's server. It reads its settings from the environment, stops at once when one is missing or
//! bad, and serves its API and its page where `HOST` and `PORT` say until Ctrl-C or `SIGTERM`.

use std::error::Error;
use std::process::ExitCode;

use hangar_core::{Docker, Environment};
use hangar_server::{App, Settings};

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

            for setting in error.errors() {
                tracing::error!("{}", with_sources(setting));
            }

            return ExitCode::FAILURE;
        }
    };
    let docker = match Docker::connect() {
        Ok(docker) => docker,
        Err(error) => {
            tracing::error!("{}", with_sources(&error));
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

    tokio.block_on(serve(&settings, docker))
}

/// Serves until told to stop, then saves what the server has not saved yet.
async fn serve(settings: &Settings, docker: Docker) -> ExitCode {
    let address = settings.address;

    match &settings.page {
        Some(page) => tracing::info!(
            "serving the page of {} and the API on {address}",
            page.display()
        ),
        None => tracing::info!(
            "serving the API on {address}, without a page: HANGAR_PAGE_DIR is not set"
        ),
    }

    let app = App::new(settings, docker).await;

    app.start().await;

    let served = hangar_server::server(settings)
        .serve(address, hangar_server::router(app.clone()))
        .await;

    app.stop().await;

    match served {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("could not serve on {address}: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `error` and its causes, each after a `: `.
fn with_sources(error: &dyn Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();

    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }

    message
}
