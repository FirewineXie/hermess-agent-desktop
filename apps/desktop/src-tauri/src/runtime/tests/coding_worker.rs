use super::*;
use serde_json::json;

#[cfg(windows)]
#[test]
#[ignore = "requires the local sealed payload and a windowless native Tauri context"]
fn production_command_passes_only_selected_product_and_payload_stores() {
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &isolated.app;
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let payload = repo.join(".build/payload").canonicalize_plain().unwrap();
    let temporary = tempfile::tempdir().unwrap();
    let command = command(
        app.handle(),
        &payload.join("bin/hermes.exe"),
        temporary.path(),
    )
    .unwrap();
    let value = command
        .as_std()
        .get_envs()
        .find(|(name, _)| *name == "HERMESS_PM_TOOL_ROOTS")
        .and_then(|(_, value)| value)
        .unwrap()
        .to_str()
        .unwrap();
    let roots: Vec<std::path::PathBuf> = serde_json::from_str(value).unwrap();
    let selected = super::super::location::selected_storage(app.handle()).unwrap();
    assert_eq!(
        roots,
        vec![
            plain_path(&selected.join("HermessAgentDesktop/hermes-home/tools")),
            plain_path(&payload.join("tools")),
        ]
    );
    assert!(roots
        .iter()
        .all(|root| !root.to_string_lossy().starts_with("\\\\?\\")));
    assert!(command
        .as_std()
        .get_envs()
        .all(|(name, _)| name != "HERMES_RUNTIME_DIR"));
}

#[test]
fn session_commands_reject_invalid_modes_targets_and_budgets_before_spawn() {
    use crate::runtime::coding_command::validate;
    for value in [
        json!({"type":"unknown"}),
        json!({"type":"plan", "mode":"unsafe"}),
        json!({"type":"goal", "action":"set", "objective":""}),
        json!({"type":"goal", "action":"update", "objective":""}),
        json!({"type":"goal", "action":"set", "objective":"test", "token_budget":-1}),
        json!({"type":"review", "target":{"type":"commit", "sha":"not-a-sha"}}),
    ] {
        assert!(validate(&value).is_err());
    }
    for value in [
        json!({"type":"compact"}),
        json!({"type":"plan", "mode":"plan"}),
        json!({"type":"goal", "action":"set", "objective":"test", "token_budget":500}),
        json!({"type":"goal", "action":"update", "objective":"edited goal"}),
        json!({"type":"review", "target":{"type":"uncommittedChanges"}}),
    ] {
        assert!(validate(&value).is_ok());
    }
}
#[test]
fn stream_completion_and_approval_are_separate_states() {
    let mut session = CodingSession {
        archived: false,
        context: None,
        project_id: None,
        id: String::new(),
        title: String::new(),
        cwd: String::new(),
        config_id: String::new(),
        model: String::new(),
        thread_id: None,
        messages: vec![],
        status: "running".into(),
        output: String::new(),
        error: String::new(),
        activity: String::new(),
        approval: None,
    };
    assert!(!apply_event(
        &mut session,
        json!({"kind":"approval", "id":"request"})
    ));
    assert!(session.approval.is_some());
    apply_event(
        &mut session,
        json!({"kind":"context", "effort":"medium", "approval_policy":"on-request"}),
    );
    apply_event(
        &mut session,
        json!({"kind":"context", "used_tokens":13, "context_window":100}),
    );
    assert_eq!(session.context.as_ref().unwrap()["used_tokens"], 13);
    assert_eq!(session.context.as_ref().unwrap()["effort"], "medium");
    apply_event(
        &mut session,
        json!({"kind":"goal", "goal":{"status":"active", "objective":"test"}}),
    );
    assert_eq!(
        session.context.as_ref().unwrap()["goal"]["status"],
        "active"
    );
    apply_event(
        &mut session,
        json!({"kind":"question", "id":"q", "questions":[]}),
    );
    assert_eq!(session.context.as_ref().unwrap()["question"]["id"], "q");
    apply_event(&mut session, json!({"kind":"question_closed", "id":"q"}));
    assert!(session.context.as_ref().unwrap()["question"].is_null());
    assert!(!apply_event(
        &mut session,
        json!({"kind":"delta", "text":"answer"})
    ));
    assert_eq!(session.output, "answer");
    assert!(apply_event(
        &mut session,
        json!({"kind":"result", "failed":true})
    ));
    assert_eq!(session.status, "failed");
}

#[tokio::test]
async fn partial_frame_survives_cancelled_read() {
    use tokio::io::AsyncWriteExt;
    let (mut writer, reader) = tokio::io::duplex(128);
    let mut reader = BufReader::new(reader);
    let mut pending = vec![];
    writer.write_all(b"{\"kind\":\"delta\",").await.unwrap();
    assert!(tokio::time::timeout(
        Duration::from_millis(20),
        read_event(&mut reader, &mut pending)
    )
    .await
    .is_err());
    assert!(!pending.is_empty());
    writer
        .write_all(b"\"text\":\"continued\"}\n")
        .await
        .unwrap();
    let event = read_event(&mut reader, &mut pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event["text"], "continued");
    assert!(pending.is_empty());
}

#[tokio::test]
async fn oversized_or_incomplete_frames_are_rejected() {
    use std::io::Cursor;
    let oversized = vec![b'x'; MAX_EVENT_BYTES + 100];
    let mut reader = BufReader::new(Cursor::new(oversized));
    let mut pending = vec![];
    assert!(read_event(&mut reader, &mut pending).await.is_err());
    assert!(pending.len() <= MAX_EVENT_BYTES);
    let mut reader = BufReader::new(Cursor::new(b"{\"kind\":\"delta\"}"));
    assert!(read_event(&mut reader, &mut vec![]).await.is_err());
}

#[test]
fn output_limit_preserves_utf8() {
    assert_eq!(bounded_text("编程任务", 7), "编程");
    assert_eq!(bounded_text("编程任务", 0), "");
}

#[test]
fn tools_preserve_message_order_stream_output_and_terminal_result_without_duplicates() {
    let mut session: CodingSession = serde_json::from_value(json!({
        "id":"s", "title":"test", "cwd":"", "config_id":"", "model":"", "thread_id":null,
        "messages":[], "status":"running", "output":"", "error":"", "activity":"", "approval":null
    }))
    .unwrap();
    apply_event(&mut session, json!({"kind":"delta", "text":"先检查"}));
    apply_event(&mut session, json!({"kind":"message", "text":"先检查"}));
    apply_event(
        &mut session,
        json!({"kind":"tool", "tool":{"id":"cmd", "type":"commandExecution", "status":"inProgress", "summary":"pwd", "output":""}}),
    );
    apply_event(
        &mut session,
        json!({"kind":"tool_delta", "id":"cmd", "text":"路径"}),
    );
    assert_eq!(session.messages[1].tool.as_ref().unwrap()["output"], "路径");
    apply_event(
        &mut session,
        json!({"kind":"tool", "tool":{"id":"cmd", "type":"commandExecution", "status":"completed", "summary":"pwd", "output":"路径", "exit_code":0}}),
    );
    apply_event(&mut session, json!({"kind":"delta", "text":"完成"}));
    apply_event(&mut session, json!({"kind":"message", "text":"完成"}));
    apply_event(&mut session, json!({"kind":"result", "text":"完成"}));
    assert_eq!(session.messages.len(), 3);
    assert_eq!(session.messages[0].text, "先检查");
    assert_eq!(
        session.messages[1].tool.as_ref().unwrap()["status"],
        "completed"
    );
    assert_eq!(session.messages[2].text, "完成");
    assert!(session.output.is_empty());
    let restored: CodingSession =
        serde_json::from_slice(&serde_json::to_vec(&session).unwrap()).unwrap();
    assert_eq!(
        restored.messages[1].tool.as_ref().unwrap()["output"],
        "路径"
    );
    apply_event(&mut session, json!({"kind":"approval", "id":"new"}));
    apply_event(&mut session, json!({"kind":"approval_closed", "id":"old"}));
    assert!(session.approval.is_some());
    apply_event(&mut session, json!({"kind":"approval_closed", "id":"new"}));
    assert!(session.approval.is_none());
}
