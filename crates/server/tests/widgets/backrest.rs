//! `backrest-summary`, on a fake Backrest.

use axum::Json;
use axum::routing::post;
use hangar_api::Widgets as _;
use hangar_api::{BackrestHealth, BackrestRepository, BackrestSummary, WidgetData};
use serde_json::{Value, json};

use super::Fixture;

/// A Backrest on port 0, whose summary has a repository that ran well, one that failed, and one that never ran.
async fn backrest() -> String {
    let router = axum::Router::new().route(
        "/v1.Backrest/GetSummaryDashboard",
        post(|Json(request): Json<Value>| async move {
            assert_eq!(request, json!({}));

            Json(json!({
                "repoSummaries": [
                    {
                        "id": "nas",
                        "backupsSuccessLast30days": "30",
                        "bytesAddedLast30days": "1048576",
                        "protectedBytes": "5000000000",
                        "nextBackupTimeMs": "1700003600000",
                        "recentBackups": {
                            "status": ["STATUS_SUCCESS", "STATUS_ERROR"],
                            "timestampMs": ["1700000000000", "1699900000000"],
                            "bytesAdded": ["1024", "0"],
                        },
                    },
                    { "id": "cloud", "recentBackups": { "status": ["STATUS_ERROR"], "timestampMs": [1_700_000_000_000_u64] } },
                    { "id": "new" },
                ],
                "planSummaries": [],
            }))
        }),
    );

    quoll::test::spawn(router).await
}

#[tokio::test]
async fn reads_each_repository_and_its_last_backup() -> quoll::Result<()> {
    let url = backrest().await;
    let fixture = Fixture::new(&format!(
        "  - {{ type: backrest-summary, column: 2, url: '{url}' }}\n"
    ));
    let server = fixture.serve().await;
    let key = server.key("backrest-summary").await;

    let data = server.api().widgets().data(&key).await?;

    assert_eq!(
        data,
        WidgetData::BackrestSummary(BackrestSummary {
            repositories: vec![
                BackrestRepository {
                    id: "nas".to_owned(),
                    status: Some("SUCCESS".to_owned()),
                    health: BackrestHealth::Healthy,
                    last_run_at: Some("2023-11-14T22:13:20.000Z".to_owned()),
                    successes: 30,
                    bytes_added: 1_048_576,
                    protected_bytes: 5_000_000_000,
                    next_backup_at: Some("2023-11-14T23:13:20.000Z".to_owned()),
                },
                BackrestRepository {
                    id: "cloud".to_owned(),
                    status: Some("ERROR".to_owned()),
                    health: BackrestHealth::Failed,
                    last_run_at: Some("2023-11-14T22:13:20.000Z".to_owned()),
                    successes: 0,
                    bytes_added: 0,
                    protected_bytes: 0,
                    next_backup_at: None,
                },
                BackrestRepository {
                    id: "new".to_owned(),
                    status: None,
                    health: BackrestHealth::NeverRun,
                    last_run_at: None,
                    successes: 0,
                    bytes_added: 0,
                    protected_bytes: 0,
                    next_backup_at: None,
                },
            ],
        })
    );
    Ok(())
}
