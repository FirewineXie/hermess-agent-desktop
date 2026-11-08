#[cfg(windows)]
#[tokio::test]
#[ignore = "uses isolated windowless Windows Tauri directories"]
async fn native_config_file_requests_roundtrip_reject_and_recover() {
    use crate::runtime::coding::{coding_session_request, CodingRequest, CodingState};
    use crate::runtime::{coding_config, coding_vault, remote_config};
    use serde_json::json;
    use std::{fs, path::Path};
    use tauri::Manager;

    let fixture = remote_config::tests::IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let request = |value| serde_json::from_value::<CodingRequest>(value).unwrap();
    let before = coding_session_request(
        app.handle().clone(),
        app.state(),
        request(json!({"action":"config_file"})),
    )
    .await
    .unwrap();
    assert_eq!(before["content"], "");
    assert!(before["path"].as_str().unwrap().ends_with("config.toml"));
    assert!(!before["path"].as_str().unwrap().starts_with(r"\\?\"));
    let content = "# 保留原文和注释\nmodel_context_window = 200000\n[mcp_servers.fixture]\nurl = 'https://fixture.invalid/mcp'\n";
    let saved = coding_session_request(
        app.handle().clone(),
        app.state(),
        request(
            json!({"action":"save_config_file","revision":before["revision"],"content":content}),
        ),
    )
    .await
    .unwrap();
    assert_eq!(saved["content"], content);
    assert_ne!(saved["revision"], before["revision"]);
    let path = coding_config::owned(app.handle(), Path::new("config.toml")).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), content);
    // Production settings and payload read the same file as the editor.
    let structured = coding_session_request(
        app.handle().clone(),
        app.state(),
        request(json!({"action":"settings"})),
    )
    .await
    .unwrap();
    assert_eq!(structured["context"]["model_context_window"], 200000);
    assert_eq!(
        super::super::coding_settings::payload(app.handle()).unwrap()["mcp_config"]["fixture"]
            ["url"],
        "https://fixture.invalid/mcp"
    );
    let stale = coding_session_request(
        app.handle().clone(),
        app.state(),
        request(json!({"action":"save_config_file","revision":before["revision"],"content":""})),
    )
    .await
    .unwrap_err();
    assert_eq!(serde_json::to_value(stale).unwrap()["code"], "conflict");
    for invalid in [
        "[broken".to_owned(),
        "\0".to_owned(),
        "#".repeat(1024 * 1024 + 1),
    ] {
        let error = coding_session_request(
            app.handle().clone(),
            app.state(),
            request(
                json!({"action":"save_config_file","revision":saved["revision"],"content":invalid}),
            ),
        )
        .await
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "invalid_input"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }
    // An externally broken TOML file must remain readable and repairable.
    fs::write(&path, "[broken").unwrap();
    let broken = coding_session_request(
        app.handle().clone(),
        app.state(),
        request(json!({"action":"config_file"})),
    )
    .await
    .unwrap();
    assert_eq!(broken["content"], "[broken");
    let repaired = coding_session_request(app.handle().clone(), app.state(), request(json!({"action":"save_config_file","revision":broken["revision"],"content":"# repaired\n"}))).await.unwrap();
    assert_eq!(repaired["content"], "# repaired\n");
    // A file change outside the client must also reject an outdated editor.
    fs::write(&path, "# external edit\n").unwrap();
    assert!(coding_session_request(
        app.handle().clone(),
        app.state(),
        request(json!({"action":"save_config_file","revision":repaired["revision"],"content":""}))
    )
    .await
    .is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "# external edit\n");
    coding_vault::private_directory(&coding_config::root(app.handle()).unwrap()).unwrap();
}
