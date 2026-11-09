use super::{
    activate_local_gateway, activate_saved_remote_gateway, delete_remote_gateway,
    saved_remote_gateway, ActiveGateway, BackendState,
};
use crate::runtime::remote_config::tests::IsolatedRemoteConfig;
use crate::runtime::remote_sidebar::gateway_sidebar_sessions;
use std::sync::Arc;
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
        assert_eq!(saved_remote_gateway(app.clone()).unwrap()[0].id, saved.id);
        assert!(fixture.entry(&saved.id).get_password().is_ok());
    }

    let state = app.state::<BackendState>();
    let lifecycle = state.6.gate.lock().await;
    let deletion = delete_remote_gateway(app.clone(), app.state(), saved.id.clone());
    tokio::pin!(deletion);
    assert!(timeout(Duration::from_millis(50), &mut deletion)
        .await
        .is_err());
    assert!(!saved_remote_gateway(app.clone()).unwrap().is_empty());
    assert!(fixture.entry(&saved.id).get_password().is_ok());
    drop(lifecycle);
    deletion
        .await
        .expect("delete after lifecycle gate becomes available");
    assert!(saved_remote_gateway(app.clone()).unwrap().is_empty());
    assert!(matches!(
        fixture.entry(&saved.id).get_password(),
        Err(keyring::Error::NoEntry)
    ));
    delete_remote_gateway(app.clone(), app.state(), saved.id)
        .await
        .expect("repeat deletion is idempotent");
    assert!(saved_remote_gateway(app.clone()).unwrap().is_empty());
}

#[tokio::test]
#[ignore = "run with isolated real Gateways using verify-multiple-gateways.py"]
async fn remote_gateway_multiple_connections_live() {
    use crate::process_manager::ProcessManager;
    use crate::runtime::{
        browser_bridge::BrowserBridgeState, channel_whatsapp::WhatsAppSetupState,
    };
    use std::path::PathBuf;

    struct Cleanup(Arc<ProcessManager>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            self.0.kill_remaining();
        }
    }
    let _cleanup = Cleanup(ProcessManager::init().unwrap());
    let mut fixture = IsolatedRemoteConfig::new();
    let first = fixture
        .save_at("host-one", &std::env::var("HERMESS_TEST_HOST_ONE").unwrap())
        .await;
    let second = fixture
        .save_at("host-two", &std::env::var("HERMESS_TEST_HOST_TWO").unwrap())
        .await;
    let app = fixture.app.handle().clone();
    let state = app.state::<BackendState>();
    app.manage(BrowserBridgeState::default());
    app.manage(WhatsAppSetupState::default());
    let local = crate::runtime::gateway_recovery::start(
        app.clone(),
        &state,
        PathBuf::from(std::env::var_os("HERMESS_TEST_LOCAL_HERMES").unwrap()),
        PathBuf::from(std::env::var_os("HERMESS_TEST_LOCAL_STORAGE").unwrap()),
        true,
    )
    .await
    .unwrap();
    let hosts = gateway_sidebar_sessions(app.clone(), app.state())
        .await
        .unwrap();
    assert_eq!(hosts.len(), 2);
    for (row, config) in hosts.iter().zip([&first, &second]) {
        assert_eq!(row["id"], config.id);
        assert_eq!(row["connected"], true);
        let sessions = row["profiles"][0]["sessions"].as_array().unwrap();
        assert!(
            sessions.iter().any(|entry| entry["title"] == config.label),
            "{sessions:?}"
        );
    }
    let connections = {
        let standby = state.7.lock().await;
        assert_eq!(standby.len(), 2);
        [
            Arc::clone(&standby[&first.id].gateway),
            Arc::clone(&standby[&second.id].gateway),
        ]
    };
    assert_ne!(connections[0].replay_epoch, connections[1].replay_epoch);
    for (i, config) in [&first, &second, &first].into_iter().enumerate() {
        let active =
            activate_saved_remote_gateway(app.clone(), app.state(), Some(config.id.clone()))
                .await
                .unwrap();
        assert!(
            matches!(active, ActiveGateway::Remote { config: active, .. } if active.id == config.id)
        );
        assert!(Arc::ptr_eq(
            &state.5.lock().await.as_ref().unwrap().gateway,
            &connections[i % 2]
        ));
        let profile = state
            .5
            .lock()
            .await
            .as_ref()
            .unwrap()
            .selected_profile
            .clone();
        let sessions = crate::runtime::chat::list_chat_sessions(app.state(), profile.clone())
            .await
            .unwrap();
        let rows = sessions["sessions"].as_array().unwrap();
        assert!(rows.iter().any(|row| row["title"] == config.label));
        let other = if i % 2 == 0 {
            &second.label
        } else {
            &first.label
        };
        assert!(!rows.iter().any(|row| row["title"].as_str() == Some(other)));
        let snapshot =
            crate::runtime::chat::resume_chat_session(app.state(), profile, "shared-id".into())
                .await
                .unwrap();
        let messages = snapshot["messages"].as_array().unwrap();
        assert!(messages
            .iter()
            .any(|message| message["content"] == format!("Only on {}", config.label)));
        assert!(!messages
            .iter()
            .any(|message| message["content"] == format!("Only on {other}")));
        let hosts = gateway_sidebar_sessions(app.clone(), app.state())
            .await
            .unwrap();
        let local_row = hosts.iter().find(|host| host["id"].is_null()).unwrap();
        assert_eq!(local_row["connected"], true);
        assert!(local_row["profiles"][0]["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["title"] == "local-host"));
        assert!(hosts
            .iter()
            .any(|host| host["label"].as_str() == Some(other) && host["connected"] == true));
    }
    assert!(activate_saved_remote_gateway(
        app.clone(),
        app.state(),
        Some(Uuid::new_v4().to_string())
    )
    .await
    .is_err());
    assert!(
        delete_remote_gateway(app.clone(), app.state(), first.id.clone())
            .await
            .is_err()
    );
    activate_local_gateway(app.clone(), app.state())
        .await
        .unwrap();
    assert!(state.5.lock().await.is_none());
    assert_eq!(
        state.0.lock().await.as_ref().unwrap().gateway.replay_epoch,
        local.replay_epoch
    );
    assert!(connections.iter().all(|client| client.is_connected()));
    let snapshot = crate::runtime::chat::resume_chat_session(
        app.state(),
        "default".into(),
        "shared-id".into(),
    )
    .await
    .unwrap();
    assert!(snapshot["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|message| message["content"] == "Only on local-host"));
    connections[1].close();
    timeout(Duration::from_secs(5), async {
        while connections[1].is_connected() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("old remote transport closes");
    let hosts = gateway_sidebar_sessions(app.clone(), app.state())
        .await
        .unwrap();
    assert!(hosts
        .iter()
        .any(|host| host["id"] == second.id && host["connected"] == true));
    {
        let standby = state.7.lock().await;
        assert!(Arc::ptr_eq(&standby[&first.id].gateway, &connections[0]));
        assert!(!Arc::ptr_eq(&standby[&second.id].gateway, &connections[1]));
    }
    assert!(state.5.lock().await.is_none());
    delete_remote_gateway(app.clone(), app.state(), second.id)
        .await
        .unwrap();
    let mut standby = state.7.lock().await;
    assert_eq!(standby.len(), 1);
    standby.remove(&first.id).unwrap().gateway.close();
    drop(standby);
    crate::runtime::stop_backend(app.state(), app.state(), app.state())
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "run with isolated loopback SSH hosts using verify-host-terminals.py"]
async fn remote_gateway_host_terminals_live() {
    use crate::panel_terminal::*;
    use crate::process_manager::ProcessManager;
    use crate::workspace_panel::WorkspaceScope;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::{json, Value};
    use tauri::Listener;

    let _manager = ProcessManager::current()
        .or_else(|_| ProcessManager::init())
        .unwrap();
    let mut fixture = IsolatedRemoteConfig::new();
    let one = fixture
        .save_with_ssh("one", "http://127.0.0.1:19120", Some("probe-one".into()))
        .await;
    let two = fixture
        .save_with_ssh("two", "http://127.0.0.1:19121", Some("probe-two".into()))
        .await;
    let app = fixture.app.handle().clone();
    app.manage(TerminalState::default());
    let scope: WorkspaceScope =
        serde_json::from_value(json!({"kind":"workspace","path":""})).unwrap();
    let (send, mut events) = tokio::sync::mpsc::unbounded_channel();
    let listener = app.listen("panel-terminal-output", move |event| {
        let _ = send.send(serde_json::from_str::<Value>(event.payload()).unwrap());
    });
    assert!(start_panel_terminal(
        app.clone(),
        app.state(),
        scope.clone(),
        Some(Uuid::new_v4().to_string())
    )
    .is_err());
    let mut ids = Vec::new();
    for target in [None, Some(one.id), Some(two.id)] {
        let terminal =
            start_panel_terminal(app.clone(), app.state(), scope.clone(), target).unwrap();
        let value = serde_json::to_value(terminal).unwrap();
        let id = value["id"].as_str().unwrap().to_owned();
        activate_panel_terminal(app.clone(), app.state(), scope.clone(), id.clone()).unwrap();
        ids.push(id);
    }
    let mut transcript = std::collections::HashMap::<String, Vec<u8>>::new();
    let mut responded = std::collections::HashSet::new();
    let result = timeout(Duration::from_secs(25), async {
        while let Some(event) = events.recv().await {
            let id = event["id"].as_str().unwrap().to_owned();
            let bytes = STANDARD.decode(event["data"].as_str().unwrap()).unwrap();
            let output = transcript.entry(id.clone()).or_default();
            output.extend(bytes);
            if output.windows(4).any(|bytes| bytes == b"\x1b[6n") && responded.insert(id.clone()) {
                // ConPTY queries the cursor while attaching. xterm answers in the live window.
                write_panel_terminal(app.state(), scope.clone(), id.clone(), "\x1b[1;1R".into())
                    .unwrap();
                if id == ids[0] {
                    write_panel_terminal(
                        app.state(),
                        scope.clone(),
                        id,
                        "echo LOCAL_HOST_READY\r".into(),
                    )
                    .unwrap();
                }
            }
            let seen = |id: &String, mark: &str| {
                transcript
                    .get(id)
                    .is_some_and(|data| String::from_utf8_lossy(data).contains(mark))
            };
            if seen(&ids[1], "HOST_ONE_READY")
                && seen(&ids[2], "HOST_TWO_READY")
                && seen(&ids[0], "LOCAL_HOST_READY")
            {
                break;
            }
        }
    })
    .await;
    for id in &ids {
        close_panel_terminal(app.state(), scope.clone(), id.clone())
            .await
            .unwrap();
    }
    result.unwrap_or_else(|_| {
        panic!(
            "SSH host banners missing: {:?}",
            transcript
                .iter()
                .map(|(key, value)| (key, String::from_utf8_lossy(value)))
                .collect::<Vec<_>>()
        )
    });
    assert!(!String::from_utf8_lossy(&transcript[&ids[1]]).contains("HOST_TWO_READY"));
    assert!(!String::from_utf8_lossy(&transcript[&ids[2]]).contains("HOST_ONE_READY"));
    app.unlisten(listener);
}
