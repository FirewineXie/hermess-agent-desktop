use super::{decrypt_qq_secret, valid_qr_url};

#[test]
fn qq_secret_matches_locked_python_aes_gcm_format() {
    // Produced by the locked fork's AESGCM(key).encrypt(iv, plaintext, None),
    // then base64(iv || ciphertext || tag).
    let key: [u8; 32] = std::array::from_fn(|index| index as u8);
    let encrypted = "AAECAwQFBgcICQoLIWuub7CXpzb+JPT51J3XNHNN/IutiaHieQYLBNls";
    assert_eq!(
        decrypt_qq_secret(encrypted, &key).unwrap(),
        "fixture-secret"
    );
    assert!(decrypt_qq_secret(encrypted, &[0; 32]).is_err());
}

#[test]
fn qr_links_stay_on_the_expected_provider() {
    assert!(valid_qr_url("https://q.qq.com/qqbot/openclaw/connect.html", "qqbot").is_ok());
    assert!(valid_qr_url("https://work.weixin.qq.com/ai/qc/gen", "wecom").is_ok());
    assert!(valid_qr_url("https://open-dev.dingtalk.com/x", "dingtalk").is_ok());
    assert!(valid_qr_url("https://evil.example/?next=q.qq.com", "qqbot").is_err());
}
