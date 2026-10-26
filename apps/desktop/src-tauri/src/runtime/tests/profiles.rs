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
        scoped_params("writer", "session.mutate", json!({"session_id": "s"})).unwrap(),
        json!({"session_id": "s"})
    );
    assert_eq!(
        scoped_params("default", "session.list", json!({"limit": 50})).unwrap(),
        json!({"limit": 50})
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
