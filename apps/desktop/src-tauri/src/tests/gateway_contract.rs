use super::{
    bound_notification_text, canonical_approval_request, is_forwarded_event, GatewayEvent,
    GatewayServerRequest,
};
use serde_json::json;

#[test]
fn forwards_reasoning_content_events() {
    assert!(is_forwarded_event("reasoning.delta"));
    assert!(is_forwarded_event("reasoning.available"));
    assert!(!is_forwarded_event("unknown.event"));
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
