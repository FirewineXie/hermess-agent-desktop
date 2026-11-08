use super::*;

#[test]
fn shared_file_is_the_source_and_invalid_context_is_rejected() {
    let source = "# preserve comment\nmodel_reasoning_effort = 'high'\n[mcp_servers.fixture]\nurl = 'https://fixture.invalid/mcp'\nenabled = false\n[skills]\nconfig = [{path='/fixture/SKILL.md', enabled=false}]\n";
    let mut settings = parse(source).unwrap();
    assert_eq!(settings.mcp_servers.len(), 1);
    assert!(!settings.mcp_servers[0].enabled);
    assert_eq!(settings.disabled_skills, vec!["/fixture/SKILL.md"]);
    settings.context.model_context_window = Some(100);
    settings.context.model_auto_compact_token_limit = Some(101);
    assert!(validate(&mut settings).is_err());
    settings.context.model_auto_compact_token_limit = Some(80);
    settings.instructions.project_doc_fallback_filenames = vec!["../secret".into()];
    assert!(validate(&mut settings).is_err());
    assert!(parse("mcp_servers = []").is_err());
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "uses isolated windowless Windows Tauri directories"]
async fn native_settings_file_roundtrip_and_project_instructions() {
    use crate::paths::plain_path;
    use crate::runtime::coding::{coding_session_request, CodingRequest, CodingState};
    use tauri::Manager;
    let fixture = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    coding_vault::private_directory(&coding_config::root(app.handle()).unwrap()).unwrap();
    let path = coding_config::owned(app.handle(), Path::new("config.toml")).unwrap();
    fs::write(&path, "# preserve comment\nmodel_reasoning_effort = 'high'\n[mcp_servers.fixture]\nurl = 'https://fixture.invalid/mcp'\n[ mcp_servers.fixture.http_headers ]\nAuthorization = 'Bearer MCP_FIXTURE_TOKEN'\n").unwrap();
    let mut settings = load(app.handle()).unwrap();
    settings.instructions.developer_instructions = "GLOBAL_INSTRUCTION_FIXTURE".into();
    settings.context.model_context_window = Some(200000);
    settings.context.model_auto_compact_token_limit = Some(150000);
    settings.context.tool_output_token_limit = Some(2048);
    settings.context.model_post_turn_compact_threshold_percent = Some(80);
    settings.context.compact_prompt = "COMPACT_INSTRUCTION_FIXTURE".into();
    let before = settings.clone();
    let request =
        serde_json::from_value::<CodingRequest>(json!({"action":"save_settings","draft":settings}))
            .unwrap();
    let saved = coding_session_request(app.handle().clone(), app.state(), request)
        .await
        .unwrap();
    assert_ne!(saved["revision"], before.revision);
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.contains("# preserve comment"));
    assert!(text.contains("MCP_FIXTURE_TOKEN"));
    assert!(text.contains("model_reasoning_effort = 'high'"));
    assert!(save(app.handle(), before).is_err());
    let payload = payload(app.handle()).unwrap();
    assert_eq!(
        payload["mcp_config"]["fixture"]["http_headers"]["Authorization"],
        "Bearer MCP_FIXTURE_TOKEN"
    );
    // Metadata is read-only in the interface; file edits are loaded on the next request.
    let mut changed = load(app.handle()).unwrap();
    changed.mcp_servers[0].enabled = false;
    assert!(save(app.handle(), changed).is_err());
    let changed = text.replace("https://fixture.invalid/mcp", "https://changed.invalid/mcp");
    fs::write(&path, changed).unwrap();
    assert_eq!(
        load(app.handle()).unwrap().mcp_servers[0].url,
        "https://changed.invalid/mcp"
    );
    let project = coding_config::owned(app.handle(), Path::new("fixture-project")).unwrap();
    coding_vault::private_directory(&project).unwrap();
    let cwd = plain_path(&project).to_string_lossy().into_owned();
    super::super::coding_projects::save(app.handle(), None, "Fixture".into(), cwd.clone()).unwrap();
    let file =
        super::super::coding_settings_files::instruction(app.handle(), cwd.clone(), None, None)
            .unwrap();
    let updated = super::super::coding_settings_files::instruction(
        app.handle(),
        cwd.clone(),
        file["revision"].as_str().map(str::to_owned),
        Some("PROJECT_INSTRUCTION_FIXTURE".into()),
    )
    .unwrap();
    assert_eq!(updated["content"], "PROJECT_INSTRUCTION_FIXTURE");
    assert!(super::super::coding_settings_files::instruction(
        app.handle(),
        cwd,
        file["revision"].as_str().map(str::to_owned),
        Some("stale".into())
    )
    .is_err());
    if let Some(export) = std::env::var_os("HERMESS_SETTINGS_FIXTURES") {
        fs::create_dir_all(&export).unwrap();
        fs::write(
            Path::new(&export).join("settings.json"),
            serde_json::to_vec_pretty(&saved).unwrap(),
        )
        .unwrap();
        fs::write(
            Path::new(&export).join("integration.json"),
            serde_json::to_vec_pretty(&payload).unwrap(),
        )
        .unwrap();
        fs::write(
            Path::new(&export).join("SKILL.md"),
            "---\nname: fixture-skill\ndescription: Fixture only\n---\nSKILL_BODY_FIXTURE\n",
        )
        .unwrap();
        let extra = Path::new(&export).join("writable-root");
        fs::create_dir_all(&extra).unwrap();
        let permission = super::super::coding_permission_settings::read(app.handle()).unwrap();
        let permission = serde_json::to_value(permission).unwrap();
        let request: CodingRequest = serde_json::from_value(json!({"action":"save_permission_settings","draft":{
            "revision":permission["revision"],"default_permissions":"hermess","approval_policy":"on-request","approvals_reviewer":"user",
            "network_access":true,"writable_roots":[plain_path(&extra)]
        }})).unwrap();
        coding_session_request(app.handle().clone(), app.state(), request)
            .await
            .unwrap();
        fs::copy(&path, Path::new(&export).join("permissions.toml")).unwrap();
    }
}
