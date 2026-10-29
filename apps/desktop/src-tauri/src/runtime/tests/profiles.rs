use super::{is_served, live_served_profiles, roster_contains, scoped_params};
use serde_json::json;
use std::fs;

#[test]
fn routes_profile_scoped_methods_without_changing_session_owned_methods() {
    assert_eq!(
        scoped_params("writer", "session.list", json!({"limit": 50})).unwrap(),
        json!({"limit": 50, "profile": "writer"})
    );
    assert_eq!(
        scoped_params("writer", "config.get", json!({})).unwrap(),
        json!({"profile": "writer"})
    );
    assert_eq!(
        scoped_params("writer", "session.stats", json!({"session_id": "s"})).unwrap(),
        json!({"profile": "writer", "session_id": "s"})
    );
    assert_eq!(
        scoped_params("writer", "session.mutate", json!({"session_id": "s"})).unwrap(),
        json!({"session_id": "s", "profile": "writer"})
    );
    assert_eq!(
        scoped_params(
            "writer",
            "file.attach",
            json!({"session_id": "s", "path": "a.txt"})
        )
        .unwrap(),
        json!({"session_id": "s", "path": "a.txt", "profile": "writer"})
    );
    assert_eq!(
        scoped_params("writer", "cron.manage", json!({"action": "list"})).unwrap(),
        json!({"action": "list", "profile": "writer"})
    );
    assert_eq!(
        scoped_params(
            "writer",
            "clarify.lock",
            json!({"request_id": "srq-1", "question_id": "q1", "answer": "choice"})
        )
        .unwrap(),
        json!({"profile": "writer", "request_id": "srq-1", "question_id": "q1", "answer": "choice"})
    );
    assert!(scoped_params("writer", "unreviewed.method", json!({})).is_err());
    assert_eq!(
        scoped_params("default", "session.list", json!({"limit": 50})).unwrap(),
        json!({"limit": 50})
    );
    assert!(scoped_params("default", "session.list", json!({"profile": "writer"})).is_err());
    assert!(scoped_params("writer", "session.list", json!({"profile": "default"})).is_err());
    assert_eq!(
        scoped_params("default", "session.list", json!({"profile": "default"})).unwrap(),
        json!({})
    );
}

#[test]
fn selection_requires_a_roster_entry_and_live_service() {
    let roster = json!({"profiles": [{"name": "default"}, {"name": "writer"}]});
    let status = json!({"gateways": [{"served_profiles": ["default", "writer"]}]});
    assert!(roster_contains(&roster, "writer"));
    assert!(is_served(&status, "writer"));
    assert!(!roster_contains(&roster, "unknown"));
    assert!(!is_served(&status, "unknown"));
    assert!(!is_served(&json!({"gateway_mode": "single"}), "writer"));
    let standalone =
        json!({"gateways": [{"profile": "default", "ports": [], "served_profiles": []}]});
    assert!(is_served(&standalone, "default"));
    assert!(!is_served(&standalone, "writer"));
    assert!(is_served(
        &json!({"gateways": [{"profile": "default"}]}),
        "default"
    ));
    assert!(!is_served(&json!({"gateways": []}), "default"));
}

#[test]
fn runtime_roster_is_used_only_for_the_owned_gateway_pid() {
    let storage = std::env::temp_dir().join(format!("hermess-profiles-{}", uuid::Uuid::new_v4()));
    let home = storage.join("hermes-home");
    fs::create_dir_all(&home).unwrap();
    fs::write(
        home.join("gateway_state.json"),
        br#"{"pid":123,"gateway_state":"running","served_profiles":["default","writer"]}"#,
    )
    .unwrap();
    assert_eq!(
        live_served_profiles(&storage, Some(123)),
        Some(vec!["default".into(), "writer".into()])
    );
    assert_eq!(live_served_profiles(&storage, Some(124)), None);
    fs::remove_dir_all(storage).unwrap();
}
