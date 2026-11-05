use super::{can_open, target_for_label, valid_session_id, ChatWindowContext, ChatWindowTarget};
use std::collections::HashMap;

#[test]
fn session_target_rejects_empty_oversized_and_control_ids() {
    assert!(!valid_session_id(""));
    assert!(!valid_session_id(&"x".repeat(257)));
    assert!(!valid_session_id("session\nother"));
    assert!(valid_session_id("session-id_123"));
}

#[test]
fn only_main_can_open_and_only_registered_child_can_read_its_target() {
    assert!(can_open("main", "session-a"));
    assert!(!can_open("quick-input", "session-a"));
    assert!(!can_open("chat-child", "session-a"));
    let mut entries = HashMap::new();
    entries.insert(
        "chat-one".to_owned(),
        ChatWindowTarget {
            profile: "alpha".to_owned(),
            session_id: "session-a".to_owned(),
        },
    );
    entries.insert(
        "chat-two".to_owned(),
        ChatWindowTarget {
            profile: "beta".to_owned(),
            session_id: "session-b".to_owned(),
        },
    );
    assert_eq!(
        target_for_label(&entries, "chat-one").unwrap().profile,
        "alpha"
    );
    assert_eq!(
        target_for_label(&entries, "chat-two").unwrap().session_id,
        "session-b"
    );
    assert!(target_for_label(&entries, "main").is_none());
    assert!(target_for_label(&entries, "chat-three").is_none());
    entries.remove("chat-one");
    assert!(target_for_label(&entries, "chat-one").is_none());
}

#[test]
fn context_serializes_the_frontend_contract_without_credentials() {
    let context = ChatWindowContext {
        target: ChatWindowTarget {
            profile: "alpha".to_owned(),
            session_id: "session-a".to_owned(),
        },
        backend: None,
        storage_path: String::new(),
    };
    let value = serde_json::to_value(context).unwrap();
    assert_eq!(value["target"]["sessionId"], "session-a");
    assert_eq!(value["storagePath"], "");
    assert!(value.get("token").is_none());
}
