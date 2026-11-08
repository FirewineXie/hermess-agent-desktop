use crate::runtime::{
    browser_bridge::BrowserBridgeState,
    channel_whatsapp::WhatsAppSetupState,
    chat::{create_chat_session, resume_chat_session, submit_chat_prompt},
    BackendState,
};
use crate::{paths::plain_path, process_manager::ProcessManager};
use std::{fs, path::PathBuf, time::Duration};
use tauri::Manager;

#[tokio::test]
#[ignore = "requires verify-chat-environment.py with isolated storage and a synthetic model"]
async fn chat_environment_live() {
    let hermes = PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_HERMES").unwrap());
    let storage = PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_STORAGE").unwrap());
    let sync = PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_SYNC").unwrap());
    let project = sync.parent().unwrap().join("project");
    let manager = ProcessManager::init().unwrap();
    struct Cleanup(std::sync::Arc<ProcessManager>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            self.0.kill_remaining();
        }
    }
    let _cleanup = Cleanup(manager);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!(
        "com.hermess.chat-env-test-{}",
        uuid::Uuid::new_v4().simple()
    );
    let app = tauri::Builder::default()
        .any_thread()
        .build(context)
        .unwrap();
    app.manage(BackendState::default());
    app.manage(BrowserBridgeState::default());
    app.manage(WhatsAppSetupState::default());
    crate::runtime::gateway_recovery::start(
        app.handle().clone(),
        &app.state(),
        hermes,
        storage.parent().unwrap().to_path_buf(),
        true,
    )
    .await
    .unwrap();
    for index in 0..2 {
        if index == 1 {
            tokio::time::timeout(Duration::from_secs(90), async {
                while !sync.join("create-second").is_file() {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            })
            .await
            .expect("driver changes the isolated PM store");
        }
        let session = create_chat_session(
            app.state(),
            "default".into(),
            Some(plain_path(&project).to_string_lossy().into_owned()),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        fs::write(
            sync.join(format!("session-{index}.json")),
            serde_json::to_vec(&session).unwrap(),
        )
        .unwrap();
    }
    tokio::time::timeout(Duration::from_secs(180), async {
        let mut index = 0;
        while !sync.join("finish").is_file() {
            let path = sync.join(format!("request-{index}.json"));
            if !path.is_file() { tokio::time::sleep(Duration::from_millis(50)).await; continue; }
            let request: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            let result = if request["action"] == "invalid" {
                let scope = app.state::<BackendState>().resolve_chat_profile("default").await.unwrap();
                let result = scope.gateway.request_detailed("session.create", serde_json::json!({
                    "source":"gui", "request_id":uuid::Uuid::new_v4().to_string(), "client_env":{"PATH":123}
                })).await;
                assert!(matches!(result, Err(crate::gateway::GatewayRequestError::Rpc { code: 4001, ref message }) if message == "invalid_params"));
                serde_json::json!({"rejected":true})
            } else {
                let session = request["session"].as_str().unwrap().to_owned();
                let tag = request["tag"].as_str().unwrap_or("");
                if request["action"] == "submit" {
                    submit_chat_prompt(app.state(), "default".into(), session.clone(), "Run the queued fixture tool.".into(), None).await.unwrap();
                }
                tokio::time::timeout(Duration::from_secs(50), async {
                    loop {
                        let snapshot = resume_chat_session(app.state(), "default".into(), session.clone()).await.unwrap();
                        if request["action"] != "submit" || (snapshot["running"] != true && snapshot["messages"].to_string().contains(tag)) { break snapshot; }
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }).await.expect("real model fixture turn settles")
            };
            fs::write(sync.join(format!("response-{index}.json")), serde_json::to_vec(&result).unwrap()).unwrap();
            index += 1;
        }
    })
    .await
    .expect("driver verifies actual tools");
    crate::runtime::stop_backend(app.state(), app.state(), app.state())
        .await
        .unwrap();
}
