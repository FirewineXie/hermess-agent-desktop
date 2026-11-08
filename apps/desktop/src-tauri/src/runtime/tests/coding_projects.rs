use super::*;
use crate::runtime::coding::{coding_session_request, CodingRequest, CodingState};
use serde_json::{json, Value};
use tauri::Manager;

async fn invoke(app: &tauri::App, request: Value) -> Result<Value, DesktopFailure> {
    let request: CodingRequest = serde_json::from_value(request).unwrap();
    coding_session_request(app.handle().clone(), app.state(), request).await
}

#[tokio::test]
async fn project_addresses_persist_and_only_new_chats_use_the_edited_directory() {
    let fixture = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let root = app.path().app_config_dir().unwrap();
    let first = root.join("first-project");
    let second = root.join("second-project");
    fs::create_dir_all(&first).unwrap();
    fs::create_dir_all(&second).unwrap();
    crate::runtime::coding_config::save(
        app.handle(),
        crate::runtime::coding_config::CodingConfigDraft {
            enabled: true,
            base_url: "https://fixture.invalid/v1".into(),
            model: "FIXTURE_ONLY".into(),
            effort: "medium".into(),
            api_key: Some("TEST_ONLY".into()),
        },
    )
    .await
    .unwrap();
    let project = invoke(
        app,
        json!({"action":"save_project","id":null,"name":"First project","cwd":first}),
    )
    .await
    .unwrap();
    let id = project["id"].as_str().unwrap();
    let original = invoke(app, json!({"action":"create","cwd":first,"project_id":id}))
        .await
        .unwrap();
    let updated = invoke(
        app,
        json!({"action":"save_project","id":id,"name":"Moved project","cwd":second}),
    )
    .await
    .unwrap();
    assert_eq!(updated["id"], project["id"]);
    let loaded = invoke(app, json!({"action":"projects"})).await.unwrap();
    assert_eq!(loaded.as_array().unwrap(), &vec![updated.clone()]);
    let previous = invoke(app, json!({"action":"read","id":original["id"]}))
        .await
        .unwrap();
    assert_eq!(previous["cwd"], original["cwd"]);
    assert_eq!(previous["project_id"], project["id"]);
    // A stale client directory cannot override the current project's address.
    let fresh = invoke(app, json!({"action":"create","cwd":first,"project_id":id}))
        .await
        .unwrap();
    assert_eq!(fresh["cwd"], updated["cwd"]);
    assert_eq!(fresh["project_id"], project["id"]);
    assert!(invoke(
        app,
        json!({"action":"save_project","id":id,"name":"Bad","cwd":root.join("missing")})
    )
    .await
    .is_err());
    assert_eq!(
        invoke(app, json!({"action":"projects"})).await.unwrap(),
        loaded
    );
    assert!(invoke(
        app,
        json!({"action":"save_project","id":null,"name":"Duplicate","cwd":second})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn legacy_history_stays_in_its_project_after_the_project_address_changes() {
    let fixture = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let root = app.path().app_config_dir().unwrap();
    let old = root.join("old-project");
    let new = root.join("new-project");
    fs::create_dir_all(&old).unwrap();
    fs::create_dir_all(&new).unwrap();
    let id = Uuid::new_v4().to_string();
    let sessions = coding_config::root(app.handle()).unwrap().join("sessions");
    fs::create_dir_all(&sessions).unwrap();
    let path = sessions.join(format!("{id}.json"));
    let record = json!({"id":id,"title":"Legacy","cwd":old,"config_id":"old","model":"fixture","thread_id":null,"messages":[],"status":"idle","output":"","error":"","activity":"","approval":null});
    fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
    let before = fs::read(&path).unwrap();
    let listed = invoke(app, json!({"action":"projects"})).await.unwrap();
    let project = &listed[0];
    let updated = invoke(
        app,
        json!({"action":"save_project","id":project["id"],"name":"Updated","cwd":new}),
    )
    .await
    .unwrap();
    assert_eq!(updated["legacy_cwds"], json!([old]));
    let listed_again = invoke(app, json!({"action":"projects"})).await.unwrap();
    assert_eq!(listed_again.as_array().unwrap().len(), 1);
    assert_eq!(listed_again[0]["id"], project["id"]);
    assert_eq!(fs::read(path).unwrap(), before);
}
