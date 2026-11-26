//! The server served on port 0, with its layers and its page, called by the client of the contract and by reqwest.

use std::path::Path;

use hangar_api::{Api, Health};
use hangar_server::{App, Settings};
use http::StatusCode;
use http::header::{ACCEPT, ACCEPT_ENCODING, CONTENT_ENCODING, CONTENT_TYPE, LOCATION};
use reqwest::redirect::Policy;

/// The settings of a test: the required variables, and the page of `page` if any.
fn settings(page: Option<&Path>) -> Settings {
    let page = page.map(|page| page.to_str().expect("a UTF-8 path").to_owned());

    Settings::read(|name| match name {
        "HANGAR_DATA_DIR" => Some("/srv/hangar".to_owned()),
        "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
        "DOMAIN" => Some("example.com".to_owned()),
        "HANGAR_URL" => Some("https://hangar.example.com".to_owned()),
        "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
        "HANGAR_PAGE_DIR" => page.clone(),
        _ => None,
    })
    .expect("the settings are valid")
}

/// Serves the server of `settings` on port 0, and gives its URL.
async fn serve(settings: &Settings) -> String {
    let router = hangar_server::server(settings)
        .into_router(hangar_server::router(App::new(settings, docker()).await));

    quoll::test::spawn(router).await
}

/// A client that reads redirects rather than follow them.
fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .expect("a client")
}

/// A page as Vite builds it: its `index.html`, `robots.txt`, and a directory of assets.
fn page() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = format!(
        "<!doctype html><html><body><div id=\"root\"></div>{}</body></html>",
        "<!-- padding, for the encoder -->".repeat(40)
    );

    std::fs::write(dir.path().join("index.html"), index).expect("written");
    std::fs::write(
        dir.path().join("robots.txt"),
        "User-agent: *\nDisallow: /api/\n",
    )
    .expect("written");
    std::fs::create_dir(dir.path().join("assets")).expect("created");
    std::fs::write(dir.path().join("assets/index-B1x2Y3z4.js"), "export {};").expect("written");

    dir
}

#[tokio::test]
async fn the_health_route_answers_the_version_to_the_client_of_the_contract() -> quoll::Result<()> {
    let url = serve(&settings(None)).await;
    let api = Api::client(&url)?;

    let health = api.health().check().await?;

    assert_eq!(health.version, hangar_core::VERSION);
    Ok(())
}

#[tokio::test]
async fn a_path_of_the_api_that_is_no_route_is_a_problem() -> reqwest::Result<()> {
    let url = serve(&settings(None)).await;

    let response = http().get(format!("{url}/api/nowhere")).send().await?;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(response.headers()[CONTENT_TYPE], "application/problem+json");
    Ok(())
}

#[tokio::test]
async fn a_final_slash_is_redirected_away_with_the_query() -> reqwest::Result<()> {
    let url = serve(&settings(None)).await;

    let response = http()
        .get(format!("{url}/api/health/?verbose=1"))
        .send()
        .await?;

    assert_eq!(response.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(response.headers()[LOCATION], "/api/health?verbose=1");
    Ok(())
}

#[tokio::test]
async fn only_a_get_or_a_head_is_redirected() -> reqwest::Result<()> {
    let url = serve(&settings(None)).await;

    let head = http().head(format!("{url}/api/health/")).send().await?;
    let post = http().post(format!("{url}/api/health/")).send().await?;

    assert_eq!(head.status(), StatusCode::MOVED_PERMANENTLY);
    assert_ne!(post.status(), StatusCode::MOVED_PERMANENTLY);
    Ok(())
}

#[tokio::test]
async fn a_path_that_names_another_host_once_trimmed_is_not_redirected() -> reqwest::Result<()> {
    let url = serve(&settings(None)).await;

    let response = http().get(format!("{url}//evil.example/")).send().await?;

    assert_ne!(response.status(), StatusCode::MOVED_PERMANENTLY);
    Ok(())
}

#[tokio::test]
async fn a_page_route_is_served_its_index_once_its_final_slash_is_gone() -> reqwest::Result<()> {
    let page = page();
    let url = serve(&settings(Some(page.path()))).await;

    let redirected = http().get(format!("{url}/apps/")).send().await?;
    let served = http()
        .get(format!("{url}/apps"))
        .header(ACCEPT, "text/html")
        .send()
        .await?;

    assert_eq!(redirected.headers()[LOCATION], "/apps");
    assert_eq!(served.status(), StatusCode::OK);
    assert!(served.text().await?.contains("<div id=\"root\">"));
    Ok(())
}

#[tokio::test]
async fn a_directory_of_the_page_with_no_index_loses_its_final_slash_and_nothing_loops()
-> reqwest::Result<()> {
    let page = page();
    let url = serve(&settings(Some(page.path()))).await;

    let slashed = http().get(format!("{url}/assets/")).send().await?;
    let bare = http().get(format!("{url}/assets")).send().await?;

    assert_eq!(slashed.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(slashed.headers()[LOCATION], "/assets");
    assert_eq!(
        bare.status(),
        StatusCode::NOT_FOUND,
        "no file, and no redirect back"
    );
    Ok(())
}

#[tokio::test]
async fn a_directory_of_the_page_with_an_index_is_left_to_the_page_so_that_nothing_loops()
-> reqwest::Result<()> {
    let page = page();
    let url = serve(&settings(Some(page.path()))).await;

    std::fs::create_dir(page.path().join("docs")).expect("created");
    std::fs::write(page.path().join("docs/index.html"), "the docs").expect("written");

    let bare = http().get(format!("{url}/docs")).send().await?;
    let slashed = http().get(format!("{url}/docs/")).send().await?;

    assert_eq!(bare.status(), StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(bare.headers()[LOCATION], "/docs/");
    assert_eq!(slashed.status(), StatusCode::OK);
    assert_eq!(slashed.text().await?, "the docs");
    Ok(())
}

#[tokio::test]
async fn a_directory_that_holds_a_compressed_index_alone_is_left_to_the_page() -> reqwest::Result<()>
{
    let page = page();
    let url = serve(&settings(Some(page.path()))).await;

    std::fs::create_dir(page.path().join("docs")).expect("created");
    std::fs::write(page.path().join("docs/index.html.gz"), "gzipped").expect("written");

    let bare = http().get(format!("{url}/docs")).send().await?;
    let slashed = http()
        .get(format!("{url}/docs/"))
        .header(ACCEPT_ENCODING, "gzip")
        .send()
        .await?;

    assert_eq!(bare.status(), StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(bare.headers()[LOCATION], "/docs/");
    assert_eq!(slashed.status(), StatusCode::OK);
    assert_eq!(slashed.headers()[CONTENT_ENCODING], "gzip");
    assert_eq!(slashed.bytes().await?.as_ref(), b"gzipped");
    Ok(())
}

#[tokio::test]
async fn the_page_serves_robots_txt() -> reqwest::Result<()> {
    let page = page();
    let url = serve(&settings(Some(page.path()))).await;

    let response = http().get(format!("{url}/robots.txt")).send().await?;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.text().await?, "User-agent: *\nDisallow: /api/\n");
    Ok(())
}

#[tokio::test]
async fn an_answer_is_gzipped_for_a_caller_that_accepts_it() -> reqwest::Result<()> {
    let page = page();
    let url = serve(&settings(Some(page.path()))).await;

    let response = http()
        .get(format!("{url}/"))
        .header(ACCEPT_ENCODING, "gzip")
        .send()
        .await?;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[CONTENT_ENCODING], "gzip");
    Ok(())
}

/// A client of no daemon: these tests call no Docker route.
fn docker() -> hangar_core::Docker {
    hangar_core::Docker::with_host("tcp://127.0.0.1:9").expect("a client")
}
