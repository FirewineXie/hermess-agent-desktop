use super::secret_key;
use uuid::Uuid;

#[test]
fn remote_secret_identity_binds_connection_id_and_url() {
    let id = Uuid::new_v4().to_string();
    let original = secret_key(&id, "https://gateway.example").unwrap();
    let changed_url = secret_key(&id, "https://other.example").unwrap();
    let changed_id = secret_key(&Uuid::new_v4().to_string(), "https://gateway.example").unwrap();
    assert_ne!(original, changed_url);
    assert_ne!(original, changed_id);
    assert!(!original.contains("gateway.example"));
    assert!(secret_key("not-an-id", "https://gateway.example").is_err());
}

#[cfg(windows)]
#[test]
fn windows_remote_secret_roundtrip_uses_credential_manager() {
    let id = Uuid::new_v4().to_string();
    let url = "https://gateway.example";
    super::store(&id, url, "test-token").unwrap();
    let loaded = super::load(&id, url);
    let mismatched = super::load(&id, "https://other.example");
    let removed = super::remove(&id, url);
    assert_eq!(loaded.unwrap().as_deref(), Some("test-token"));
    assert_eq!(mismatched.unwrap(), None);
    removed.unwrap();
    assert_eq!(super::load(&id, url).unwrap(), None);
}
