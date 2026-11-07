use super::{
    bound_notification_text, canonical_approval_request, is_forwarded_event,
    project_subagent_event, remote_ws_url, GatewayEvent, GatewayServerRequest,
};
use serde_json::json;

#[test]
fn remote_static_token_is_sent_only_to_a_loopback_tunnel() {
    let url = remote_ws_url("http://127.0.0.1:9119/hermes/", "token with spaces").unwrap();
    assert_eq!(
        url.as_str(),
        "ws://127.0.0.1:9119/hermes/api/ws?token=token+with+spaces"
    );
    for base in [
        "http://cloud.example:9119",
        "https://cloud.example",
        "http://user@127.0.0.1:9119",
        "http://127.0.0.1:9119/?other=1",
    ] {
        assert!(remote_ws_url(base, "token").is_err(), "{base}");
    }
    assert!(remote_ws_url("http://127.0.0.1:9119", "").is_err());
}

#[test]
fn forwards_reasoning_content_events() {
    assert!(is_forwarded_event("reasoning.delta"));
    assert!(is_forwarded_event("reasoning.available"));
    assert!(!is_forwarded_event("unknown.event"));
}

#[test]
fn forwards_unstreamed_assistant_segments() {
    assert!(is_forwarded_event("message.interim"));
}

#[test]
fn forwards_runtime_notification_and_background_events() {
    for kind in [
        "background.complete",
        "btw.complete",
        "notification.show",
        "notification.clear",
    ] {
        assert!(is_forwarded_event(kind));
    }
    assert!(!is_forwarded_event("credits.fake"));
    assert!(!is_forwarded_event("plugin.fake"));
}

#[test]
fn forwards_session_list_change_signal() {
    assert!(is_forwarded_event("sessions.changed"));
}

#[test]
fn forwards_only_bounded_subagent_state() {
    for kind in [
        "subagent.spawn_requested",
        "subagent.start",
        "subagent.progress",
        "subagent.complete",
    ] {
        assert!(is_forwarded_event(kind));
    }
    assert!(!is_forwarded_event("subagent.thinking"));
    assert!(!is_forwarded_event("subagent.text"));
    let mut payload = json!({"subagent_id":"child-1", "status":"completed", "tool_name":"read_file", "text":"private output", "tool_preview":"private path"});
    project_subagent_event("subagent.complete", &mut payload);
    assert_eq!(
        payload,
        json!({"subagent_id":"child-1", "status":"completed", "tool_name":"read_file"})
    );
}

#[test]
fn large_notification_text_keeps_identity_and_does_not_change_chat_events() {
    let original = json!({"task_id":"task", "text":"中文".repeat(40000)});
    let mut notice = original.clone();
    bound_notification_text("background.complete", &mut notice);
    assert_eq!(notice["task_id"], "task");
    assert!(notice["text"].as_str().unwrap().len() <= 16 * 1024);
    assert_eq!(notice["truncated"], true);
    assert!(notice.to_string().len() < 32 * 1024);
    let mut side =
        json!({"task_id":"btw_test", "question":"问题".repeat(40000), "text":"中文".repeat(40000)});
    bound_notification_text("btw.complete", &mut side);
    assert_eq!(side["task_id"], "btw_test");
    assert_eq!(side["question"].as_str().unwrap().chars().count(), 1024);
    assert_eq!(side["text"].as_str().unwrap().chars().count(), 1024);
    let mut chat = original.clone();
    bound_notification_text("message.complete", &mut chat);
    assert_eq!(chat, original);
}

#[test]
fn event_serialization_uses_contract_fields() {
    let with_session = GatewayEvent {
        kind: "message.delta".into(),
        profile: Some("writer".into()),
        session_id: Some("session-fixture".into()),
        seq: Some(2),
        payload: json!({"text":"hello"}),
    };
    let without_session = GatewayEvent {
        kind: "status.update".into(),
        profile: None,
        session_id: None,
        seq: None,
        payload: json!({}),
    };
    let expected = json!({
        "kind": "message.delta", "profile": "writer", "session_id": "session-fixture",
        "seq": 2, "payload": {"text": "hello"}
    });
    let expected_no_session = json!({"kind": "status.update", "payload": {}});
    assert_eq!(serde_json::to_value(with_session).unwrap(), expected);
    assert_eq!(
        serde_json::to_value(without_session).unwrap(),
        expected_no_session
    );
}

#[test]
fn request_serialization_uses_contract_fields() {
    let request = GatewayServerRequest {
        id: "srq-1".into(),
        method: "approval".into(),
        profile: Some("writer".into()),
        params: json!({
            "session_id":"session-fixture",
            "request_id":"request-fixture",
            "description":"Run a tool",
            "command":"tool command",
            "choices":["once","deny"],
            "tool_name":null
        }),
    };
    let expected = json!({
        "id": "srq-1", "method": "approval", "profile": "writer", "params": {
            "session_id": "session-fixture", "request_id": "request-fixture",
            "description": "Run a tool", "command": "tool command",
            "choices": ["once", "deny"], "tool_name": null
        }
    });
    assert_eq!(serde_json::to_value(request).unwrap(), expected);
    let clarify = GatewayServerRequest {
        id: "srq-2".into(),
        method: "clarify".into(),
        profile: Some("writer".into()),
        params: json!({
            "session_id":"session-fixture",
            "questions":[{"qid":"q1","question":"Which option?","choices":null}],
            "answers":{"q1":null}
        }),
    };
    let expected_clarify = json!({
        "id": "srq-2", "method": "clarify", "profile": "writer", "params": {
            "session_id": "session-fixture",
            "questions": [{"qid": "q1", "question": "Which option?", "choices": null}],
            "answers": {"q1": null}
        }
    });
    assert_eq!(serde_json::to_value(clarify).unwrap(), expected_clarify);
}

#[test]
fn canonical_approval_event_maps_to_the_existing_card_contract() {
    let request = canonical_approval_request(
        "session-fixture",
        Some("writer"),
        &json!({
            "kind":"approval",
            "prompt_id":"approval-fixture",
            "execution_generation":7,
            "command":"rm -rf /tmp/probe",
            "description":"recursive delete",
            "choices":["once","deny"]
        }),
    )
    .unwrap();
    assert_eq!(request.id, "approval-fixture");
    assert_eq!(request.method, "approval");
    assert_eq!(request.profile.as_deref(), Some("writer"));
    assert_eq!(request.params["session_id"], "session-fixture");
    assert_eq!(request.params["request_id"], "approval-fixture");
    assert_eq!(request.params["execution_generation"], 7);
    assert_eq!(request.params["choices"], json!(["once", "deny"]));
}
