use super::{
    coding_session_request, persist, session_path, CodingRequest, CodingSession, CodingState,
    LiveSession,
};
use crate::{paths::filesystem_path, runtime::remote_config::tests::IsolatedRemoteConfig};
use serde_json::{json, Value};
use std::{fs, sync::Arc};
use tauri::Manager;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

async fn invoke(app: &tauri::App, request: Value) -> Result<Value, crate::errors::DesktopFailure> {
    coding_session_request(
        app.handle().clone(),
        app.state(),
        serde_json::from_value::<CodingRequest>(request).unwrap(),
    )
    .await
}

#[tokio::test]
async fn archive_persists_and_restores_legacy_sessions_without_losing_history() {
    let fixture = IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let id = Uuid::new_v4().to_string();
    // Existing on-disk sessions have no archive field.
    let legacy = json!({"id":id,"title":"Archive fixture","cwd":"C:\\fixture","config_id":"fixture",
        "model":"fixture-model","thread_id":"preserved-thread","messages":[{"role":"user","text":"preserved history","images":[]}],
        "status":"completed","output":"","error":"","activity":"","approval":null});
    let session: CodingSession = serde_json::from_value(legacy).unwrap();
    assert!(!session.archived);
    persist(app.handle(), &session).unwrap();
    for archived in [true, false] {
        let saved = invoke(app, json!({"action":"archive","id":id,"archived":archived}))
            .await
            .unwrap();
        assert_eq!(saved["archived"], archived);
        assert_eq!(saved["thread_id"], "preserved-thread");
        assert_eq!(saved["messages"][0]["text"], "preserved history");
        let disk: Value = serde_json::from_slice(
            &fs::read(filesystem_path(&session_path(app.handle(), &id).unwrap())).unwrap(),
        )
        .unwrap();
        assert_eq!(disk["archived"], archived);
        let listed = invoke(app, json!({"action":"list"})).await.unwrap();
        assert_eq!(listed[0]["archived"], archived);
        let reloaded = invoke(app, json!({"action":"read","id":id})).await.unwrap();
        assert_eq!(reloaded["messages"], saved["messages"]);
        if archived {
            assert!(invoke(
                app,
                json!({"action":"send","id":id,"text":"must restore first"})
            )
            .await
            .is_err());
        }
    }
    assert!(serde_json::from_value::<CodingRequest>(
        json!({"action":"archive","id":id,"archived":"true"})
    )
    .is_err());
    assert!(invoke(
        app,
        json!({"action":"archive","id":"../escape","archived":true})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn deleting_a_session_cleans_owned_data_and_preserves_project_files() {
    let fixture = IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let id = Uuid::new_v4().to_string();
    let project = app
        .path()
        .app_config_dir()
        .unwrap()
        .join("preserved-project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("source.txt"), "preserved project source").unwrap();
    let directory = crate::runtime::coding_config::owned(
        app.handle(),
        &std::path::Path::new("threads").join(&id),
    )
    .unwrap();
    fs::create_dir_all(filesystem_path(&directory)).unwrap();
    fs::write(
        filesystem_path(&directory.join("history.json")),
        "owned runtime data",
    )
    .unwrap();
    let session: CodingSession = serde_json::from_value(json!({"id":id,"title":"Delete fixture","cwd":crate::paths::plain_path(&project),"config_id":"fixture",
        "model":"fixture","thread_id":null,"messages":[],"status":"completed","output":"","error":"","activity":"","approval":null})).unwrap();
    persist(app.handle(), &session).unwrap();
    invoke(app, json!({"action":"remove","id":id}))
        .await
        .unwrap();
    assert!(!filesystem_path(&session_path(app.handle(), &id).unwrap()).exists());
    assert!(!filesystem_path(&directory).exists());
    assert_eq!(
        fs::read_to_string(project.join("source.txt")).unwrap(),
        "preserved project source"
    );
}

#[tokio::test]
async fn archive_rejects_live_sessions_without_changing_disk() {
    let fixture = IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let id = Uuid::new_v4().to_string();
    let session: CodingSession = serde_json::from_value(json!({"id":id,"title":"Live fixture","cwd":"C:\\fixture","config_id":"fixture",
        "model":"fixture","thread_id":null,"messages":[],"status":"running","output":"","error":"","activity":"","approval":null})).unwrap();
    persist(app.handle(), &session).unwrap();
    let (control, _receiver) = mpsc::channel(1);
    app.state::<CodingState>().live.lock().await.insert(
        id.clone(),
        LiveSession {
            session: Arc::new(Mutex::new(session)),
            control,
        },
    );
    assert!(
        invoke(app, json!({"action":"archive","id":id,"archived":true}))
            .await
            .is_err()
    );
    assert!(invoke(app, json!({"action":"remove","id":id}))
        .await
        .is_err());
    let disk: Value = serde_json::from_slice(
        &fs::read(filesystem_path(&session_path(app.handle(), &id).unwrap())).unwrap(),
    )
    .unwrap();
    assert_eq!(disk["archived"], false);
}
