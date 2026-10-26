use super::valid_weixin_base;

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
