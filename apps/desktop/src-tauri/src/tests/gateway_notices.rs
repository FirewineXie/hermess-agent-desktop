use super::{GatewayEvent, NoticeSource};
use serde_json::{json, to_value, Value};

fn event(kind: &str, payload: Value) -> GatewayEvent {
    GatewayEvent {
        kind: kind.into(),
        profile: Some("default".into()),
        session_id: Some("session".into()),
        seq: Some(12),
        payload,
    }
}

#[test]
fn projects_gateway_identity_and_matches_show_to_withdrawal() {
    let source = NoticeSource::Remote("remote-a".into());
    let show = event(
        "notification.show",
        json!({"key":"test", "text":"x".repeat(500)}),
    );
    let clear = event("notification.clear", json!({"key":"test"}));
    let shown = to_value(source.project(&show).unwrap()).unwrap();
    let cleared = to_value(source.project(&clear).unwrap()).unwrap();
    assert_eq!(shown["gatewayId"], "remote-a");
    assert_eq!(shown["id"], cleared["id"]);
    assert_eq!(shown["text"].as_str().unwrap().len(), 300);
    assert!(cleared["text"].is_null());
    assert!(to_value(NoticeSource::Local.project(&show).unwrap()).unwrap()["gatewayId"].is_null());
}

#[test]
fn supports_unkeyed_notices_and_ignores_non_notification_traffic() {
    let source = NoticeSource::Local;
    assert!(source
        .project(&event(
            "notification.show",
            json!({"text":"an unkeyed notice"})
        ))
        .is_some());
    assert!(source
        .project(&event("message.delta", json!({"text":"token"})))
        .is_none());
    assert!(source
        .project(&event(
            "background.complete",
            json!({"task_id":"bg_1","text":"done"})
        ))
        .is_some());
}
