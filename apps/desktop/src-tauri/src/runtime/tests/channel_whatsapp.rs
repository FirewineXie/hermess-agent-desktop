use super::{
    normalize_allowed_users, normalize_mode, safe_pairing_id, whatsapp_config_body,
    whatsapp_start_body,
};

#[test]
fn pairing_id_cannot_escape_the_gateway_route() {
    assert!(safe_pairing_id("81d4a74a-f704-4867-915a-824b7eb2e044"));
    assert!(!safe_pairing_id("../api/env"));
    assert!(!safe_pairing_id("a?profile=other"));
}

#[test]
fn whatsapp_inputs_match_locked_receiver_normalization() {
    assert_eq!(normalize_mode(" SELF-CHAT ").unwrap(), "self-chat");
    assert!(normalize_mode("assistant").is_err());
    assert_eq!(
        normalize_allowed_users(" 1555 123, , 1555 456 ").unwrap(),
        "1555123,1555456"
    );
    assert!(normalize_allowed_users("1555\n123").is_err());
}

#[test]
fn self_chat_uses_the_linked_account_when_allowlist_is_blank() {
    let body = whatsapp_config_body(
        "default",
        "self-chat",
        "",
        Some("15551234567"),
        Some("15551234567:1@s.whatsapp.net"),
    )
    .unwrap();
    assert_eq!(body["env"]["WHATSAPP_MODE"], "self-chat");
    assert_eq!(body["env"]["WHATSAPP_ALLOWED_USERS"], "15551234567");

    let preserved = whatsapp_config_body("default", "bot", "", None, None).unwrap();
    assert!(preserved["env"].get("WHATSAPP_ALLOWED_USERS").is_none());
}

#[test]
#[ignore]
fn print_production_channel_shapes() {
    println!(
        "CHANNEL_SHAPE={}",
        serde_json::json!({
            "kind": "whatsapp_start",
            "method": "POST",
            "path": "/api/messaging/whatsapp/onboarding/start",
            "body": whatsapp_start_body("default", "self-chat", "1555 123", true).unwrap(),
        })
    );
    println!(
        "CHANNEL_SHAPE={}",
        serde_json::json!({
            "kind": "whatsapp_config",
            "method": "PUT",
            "path": "/api/messaging/platforms/whatsapp",
            "body": whatsapp_config_body("default", "self-chat", "", Some("1555123"), None).unwrap(),
        })
    );
}
