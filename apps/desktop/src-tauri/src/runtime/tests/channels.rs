use super::{channel_access_env, valid_weixin_base};

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
