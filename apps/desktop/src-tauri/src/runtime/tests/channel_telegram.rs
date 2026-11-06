use super::{normalize_allowed_user_ids, telegram_config_body};

#[test]
fn telegram_allowed_users_match_locked_receiver_normalization() {
    assert_eq!(
        normalize_allowed_user_ids(vec![" 123 ".into(), "456".into(), "123".into()]).unwrap(),
        vec!["123", "456"]
    );
    assert!(normalize_allowed_user_ids(vec![]).is_err());
    assert!(normalize_allowed_user_ids(vec!["@owner".into()]).is_err());
}

#[test]
fn telegram_config_body_saves_every_allowed_user() {
    let body = telegram_config_body(
        "research",
        "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        vec!["123".into(), "456".into()],
    )
    .unwrap();
    assert_eq!(body["profile"], "research");
    assert_eq!(body["env"]["TELEGRAM_ALLOWED_USERS"], "123,456");
}

#[test]
#[ignore]
fn print_production_channel_shapes() {
    let telegram = telegram_config_body(
        "default",
        "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        vec!["123456789".into(), "987654321".into()],
    )
    .unwrap();
    println!(
        "CHANNEL_SHAPE={}",
        serde_json::json!({
            "kind": "telegram_config",
            "method": "PUT",
            "path": "/api/messaging/platforms/telegram",
            "body": telegram,
        })
    );
}
