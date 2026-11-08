use super::*;
use uuid::Uuid;
#[test]
fn authenticated_encryption_and_installation_keys() {
    let root = std::env::temp_dir().join(format!("hermess-vault-test-{}", Uuid::new_v4()));
    let a = root.join("a");
    let b = root.join("b");
    let secret = b"TEST_ONLY_PROXY_KEY";
    let first = encrypt(&a, secret, true).unwrap();
    let second = encrypt(&a, secret, false).unwrap();
    assert_ne!(first, second);
    assert_eq!(decrypt(&a, &first).unwrap(), secret);
    encrypt(&b, secret, true).unwrap();
    assert_ne!(
        fs::read(a.join("master.key")).unwrap(),
        fs::read(b.join("master.key")).unwrap()
    );
    assert!(decrypt(&b, &first).is_err());
    let mut corrupt = first.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(decrypt(&a, &corrupt).is_err());
    fs::remove_file(a.join("master.key")).unwrap();
    assert!(decrypt(&a, &first).is_err());
    assert!(encrypt(&a, secret, false).is_err());
    assert!(!a.join("master.key").exists());
    fs::remove_dir_all(root).unwrap();
}
