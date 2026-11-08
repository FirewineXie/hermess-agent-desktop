use super::{delete_remote_gateway, saved_remote_gateway, BackendState};
use crate::runtime::remote_config::tests::IsolatedRemoteConfig;
use tauri::Manager;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

#[tokio::test]
#[ignore = "uses isolated Windows Tauri directories and random native credential entries"]
async fn remote_gateway_delete_command_live() {
    let mut fixture = IsolatedRemoteConfig::new();
    let old = fixture.save("old config").await;
    let saved = fixture.save("current config").await;
    let app = fixture.app.handle().clone();
    for (id, expected) in [
        ("not-a-uuid".to_owned(), "invalid_input"),
        (old.id, "conflict"),
        (Uuid::new_v4().to_string(), "conflict"),
    ] {
        let failure = delete_remote_gateway(app.clone(), app.state(), id)
            .await
            .expect_err("invalid or stale config cannot be deleted");
        assert_eq!(serde_json::to_value(failure).unwrap()["code"], expected);
        assert_eq!(
            saved_remote_gateway(app.clone()).unwrap().unwrap().id,
            saved.id
        );
        assert!(fixture.entry(&saved.id).get_password().is_ok());
    }

    let state = app.state::<BackendState>();
    let lifecycle = state.6.gate.lock().await;
    let deletion = delete_remote_gateway(app.clone(), app.state(), saved.id.clone());
    tokio::pin!(deletion);
    assert!(timeout(Duration::from_millis(50), &mut deletion)
        .await
        .is_err());
    assert!(saved_remote_gateway(app.clone()).unwrap().is_some());
    assert!(fixture.entry(&saved.id).get_password().is_ok());
    drop(lifecycle);
    deletion
        .await
        .expect("delete after lifecycle gate becomes available");
    assert!(saved_remote_gateway(app.clone()).unwrap().is_none());
    assert!(matches!(
        fixture.entry(&saved.id).get_password(),
        Err(keyring::Error::NoEntry)
    ));
    delete_remote_gateway(app.clone(), app.state(), saved.id)
        .await
        .expect("repeat deletion is idempotent");
    assert!(saved_remote_gateway(app.clone()).unwrap().is_none());
}
