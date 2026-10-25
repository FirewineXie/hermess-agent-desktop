use super::{is_forwarded_event, GatewayEvent, GatewayServerRequest};
use serde_json::json;

#[test]
fn forwards_reasoning_content_events() {
    assert!(is_forwarded_event("reasoning.delta"));
    assert!(is_forwarded_event("reasoning.available"));
    assert!(!is_forwarded_event("unknown.event"));
}

#[test]
fn event_serialization_uses_contract_fields() {
    let with_session = GatewayEvent {
        kind: "message.delta".into(),
        session_id: Some("session-fixture".into()),
        seq: Some(2),
        payload: json!({"text":"hello"}),
    };
    let without_session = GatewayEvent {
        kind: "status.update".into(),
        session_id: None,
        seq: None,
        payload: json!({}),
    };
    let expected = json!({
        "kind": "message.delta", "session_id": "session-fixture",
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
        "id": "srq-1", "method": "approval", "params": {
            "session_id": "session-fixture", "request_id": "request-fixture",
            "description": "Run a tool", "command": "tool command",
            "choices": ["once", "deny"], "tool_name": null
        }
    });
    assert_eq!(serde_json::to_value(request).unwrap(), expected);
    let clarify = GatewayServerRequest {
        id: "srq-2".into(),
        method: "clarify".into(),
        params: json!({
            "session_id":"session-fixture",
            "questions":[{"qid":"q1","question":"Which option?","choices":null}],
            "answers":{"q1":null}
        }),
    };
    let expected_clarify = json!({
        "id": "srq-2", "method": "clarify", "params": {
            "session_id": "session-fixture",
            "questions": [{"qid": "q1", "question": "Which option?", "choices": null}],
            "answers": {"q1": null}
        }
    });
    assert_eq!(serde_json::to_value(clarify).unwrap(), expected_clarify);
}
