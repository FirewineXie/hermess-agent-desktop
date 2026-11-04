use super::{
    channel_access_env, safe_status_message, safe_status_url, valid_weixin_base,
    whatsapp_setup_summary,
};
use serde_json::json;

#[test]
fn channel_access_modes_match_gateway_policy_keys() {
    let feishu_open = channel_access_env("feishu", "open").unwrap();
    let feishu_pairing = channel_access_env("feishu", "pairing").unwrap();
    assert_eq!(feishu_open["FEISHU_ALLOW_ALL_USERS"], "true");
    assert_eq!(feishu_pairing["FEISHU_ALLOW_ALL_USERS"], "false");
    let weixin_open = channel_access_env("weixin", "open").unwrap();
    let weixin_pairing = channel_access_env("weixin", "pairing").unwrap();
    assert_eq!(weixin_open["WEIXIN_DM_POLICY"], "open");
    assert_eq!(weixin_open["WEIXIN_ALLOW_ALL_USERS"], "true");
    assert_eq!(weixin_pairing["WEIXIN_DM_POLICY"], "pairing");
    assert_eq!(weixin_pairing["WEIXIN_ALLOW_ALL_USERS"], "false");
    assert!(channel_access_env("weixin", "other").is_err());
}

#[test]
fn whatsapp_status_exposes_only_safe_setup_metadata() {
    let platform = json!({
        "whatsapp_setup": {
            "mode": "self-chat",
            "allowed_users_set": true,
            "home_channel_set": false,
            "secret": "must-not-cross-the-webview-boundary"
        }
    });
    assert_eq!(
        whatsapp_setup_summary(&platform),
        Some(json!({
            "mode": "self-chat",
            "allowed_users_set": true,
            "home_channel_set": false
        }))
    );
}

#[test]
fn channel_status_message_is_bounded_and_rejects_control_bytes() {
    let useful = json!("Token rejected by the remote platform");
    assert_eq!(
        safe_status_message(Some(&useful)),
        Some("Token rejected by the remote platform")
    );
    let oversized = json!("x".repeat(2049));
    assert_eq!(safe_status_message(Some(&oversized)), None);
    let control = json!("failed\u{0000}hidden");
    assert_eq!(safe_status_message(Some(&control)), None);
}

#[test]
fn channel_status_urls_allow_only_safe_web_links() {
    let docs = json!("https://example.com/setup");
    let callback = json!("http://127.0.0.1:8644/hooks/events");
    let credentials = json!("https://user:secret@example.com/setup");
    let script = json!("javascript:alert(1)");
    assert_eq!(safe_status_url(Some(&docs), true), docs.as_str());
    assert_eq!(safe_status_url(Some(&callback), false), callback.as_str());
    assert_eq!(safe_status_url(Some(&callback), true), None);
    assert_eq!(safe_status_url(Some(&credentials), false), None);
    assert_eq!(safe_status_url(Some(&script), false), None);
}

#[test]
fn weixin_redirect_cannot_change_request_origin() {
    assert!(valid_weixin_base("https://ilinkai.weixin.qq.com"));
    assert!(valid_weixin_base("https://region.weixin.qq.com"));
    assert!(!valid_weixin_base(
        "https://evil.example/path.weixin.qq.com"
    ));
    assert!(!valid_weixin_base(
        "https://evil.example?next=.weixin.qq.com"
    ));
    assert!(!valid_weixin_base("http://ilinkai.weixin.qq.com"));
    assert!(!valid_weixin_base("https://ilinkai.weixin.qq.com:8443"));
}
