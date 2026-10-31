use super::{valid_platform, validate_update, whatsapp_session_linked, ChannelUpdate};
use serde_json::json;
use std::collections::HashMap;

#[test]
fn enables_only_with_complete_declared_credentials() {
    let entry = json!({"env_vars":[
        {"key":"BOT_ID", "required":true, "is_set":true},
        {"key":"BOT_SECRET", "required":true, "is_set":false},
    ]});
    let mut update = ChannelUpdate {
        env: HashMap::new(),
        clear_env: vec![],
        enabled: Some(true),
    };
    assert!(validate_update(&entry, &update).is_err());
    update.env.insert("BOT_SECRET".into(), "new-secret".into());
    assert!(validate_update(&entry, &update).is_ok());
    update.clear_env.push("BOT_ID".into());
    assert!(validate_update(&entry, &update).is_err());
    update.clear_env.clear();
    update.env.insert("UNDECLARED".into(), "x".into());
    assert!(validate_update(&entry, &update).is_err());
}

#[test]
fn platform_id_cannot_escape_the_gateway_path() {
    assert!(valid_platform("telegram"));
    assert!(valid_platform("google_chat"));
    assert!(!valid_platform("../api/env"));
    assert!(!valid_platform("Telegram"));
}

#[test]
fn whatsapp_needs_a_linked_session_in_the_effective_location() {
    let root = std::env::temp_dir().join(format!("hermess-channel-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    assert!(!whatsapp_session_linked(&root));
    let current = root.join("platforms/whatsapp/session");
    std::fs::create_dir_all(&current).unwrap();
    std::fs::write(current.join("creds.json"), "{}").unwrap();
    assert!(whatsapp_session_linked(&root));
    let legacy = root.join("whatsapp/session");
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(legacy.join("other.txt"), "legacy").unwrap();
    assert!(!whatsapp_session_linked(&root));
    std::fs::remove_file(legacy.join("other.txt")).unwrap();
    std::fs::remove_file(current.join("creds.json")).unwrap();
    std::fs::remove_dir(legacy).unwrap();
    std::fs::remove_dir(root.join("whatsapp")).unwrap();
    std::fs::remove_dir(current).unwrap();
    std::fs::remove_dir(root.join("platforms/whatsapp")).unwrap();
    std::fs::remove_dir(root.join("platforms")).unwrap();
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn yuanbao_requires_actual_credentials_despite_catalog_omission() {
    let entry = json!({"id":"yuanbao", "env_vars":[
        {"key":"YUANBAO_APP_ID", "is_set":false},
        {"key":"YUANBAO_APP_SECRET", "is_set":false},
    ]});
    let mut update = ChannelUpdate {
        env: HashMap::new(),
        clear_env: vec![],
        enabled: Some(true),
    };
    assert!(validate_update(&entry, &update).is_err());
    update.env.insert("YUANBAO_APP_ID".into(), "app".into());
    update
        .env
        .insert("YUANBAO_APP_SECRET".into(), "secret".into());
    assert!(validate_update(&entry, &update).is_ok());
}

#[test]
fn empty_optional_catalog_cannot_activate() {
    let entry =
        json!({"id":"a2a", "env_vars":[{"key":"A2A_HOST", "required":false, "is_set":false}]});
    let update = ChannelUpdate {
        env: HashMap::new(),
        clear_env: vec![],
        enabled: Some(true),
    };
    assert!(validate_update(&entry, &update).is_err());
}
